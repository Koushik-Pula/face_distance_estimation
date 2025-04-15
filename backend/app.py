import base64
import cv2
import numpy as np
import os
import logging
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
import asyncio

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_PATH = "face_detection_yunet_2023mar.onnx"
if not os.path.exists(MODEL_PATH):
    raise FileNotFoundError(f"Model file '{MODEL_PATH}' not found!")

face_detector = cv2.FaceDetectorYN.create(
    MODEL_PATH, "", (320, 320), score_threshold=0.4, nms_threshold=0.3, top_k=5000
)

KNOWN_FACE_WIDTH = 0.15  
FOCAL_LENGTH = None  
TARGET_DISTANCE = 4.0  

calibration_active = False
distance_measurement_active = False

def calculate_distance(face_width):
    return round((KNOWN_FACE_WIDTH * FOCAL_LENGTH) / face_width, 2) if FOCAL_LENGTH and face_width > 0 else -1

def calculate_expected_face_width_at_distance(distance):
    return int((KNOWN_FACE_WIDTH * FOCAL_LENGTH) / distance) if FOCAL_LENGTH else 0

def calibrate_focal_length(face_width, known_distance=0.7):
    global FOCAL_LENGTH
    FOCAL_LENGTH = (face_width * known_distance) / KNOWN_FACE_WIDTH
    logger.info(f"Focal length calibrated: {FOCAL_LENGTH}")
    return FOCAL_LENGTH

def create_processed_image(frame, faces, quality=70):
    """Draw face detection results on the image and convert back to base64 with specified quality"""
    output_frame = frame.copy()
    height, width = output_frame.shape[:2]
    center_x, center_y = width // 2, height // 2
    
    
    if distance_measurement_active and FOCAL_LENGTH:
        expected_face_width = calculate_expected_face_width_at_distance(TARGET_DISTANCE)
        if expected_face_width > 0:
    
            expected_face_height = int(expected_face_width * 1.5)
            
            ref_x = center_x - expected_face_width // 2
            ref_y = center_y - expected_face_height // 2
            
            cv2.rectangle(output_frame, 
                         (ref_x, ref_y), 
                         (ref_x + expected_face_width, ref_y + expected_face_height), 
                         (0, 0, 255), 2)  

            cv2.putText(output_frame, f"4m Reference", (ref_x, ref_y - 10), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)
    
 
    if faces is not None:
        for face in faces:
            x, y, w, h, confidence = map(float, face[:5])
            x, y, w, h = int(x), int(y), int(w), int(h)
            cv2.rectangle(output_frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
            text = f"{confidence:.2f}"
            cv2.putText(output_frame, text, (x, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)
    
            if distance_measurement_active and FOCAL_LENGTH:
                distance = calculate_distance(w)
                if distance > 0:
                    distance_text = f"{distance}m"
                    cv2.putText(output_frame, distance_text, (x, y + h + 20), 
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 0), 2)
    
    encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), quality]
    _, buffer = cv2.imencode('.jpg', output_frame, encode_param)
    img_str = base64.b64encode(buffer).decode('utf-8')
    return f"data:image/jpeg;base64,{img_str}"

async def process_image(image_data):
    global calibration_active, distance_measurement_active
    try:
        img_bytes = base64.b64decode(image_data.split(',')[-1])
        img_np = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(img_np, cv2.IMREAD_COLOR)
        if frame is None:
            return {"error": "Invalid image"}

        height, width = frame.shape[:2]
        if width > 640:
            scale = 640 / width
            frame = cv2.resize(frame, (640, int(height * scale)))

        h, w = frame.shape[:2]
        face_detector.setInputSize((w, h))
        results = face_detector.detect(frame)
        faces = results[1] if results is not None and len(results) > 1 else None

        reference_box = None
        if FOCAL_LENGTH:
            expected_width = calculate_expected_face_width_at_distance(TARGET_DISTANCE)
            if expected_width > 0:
                reference_box = {
                    "width": expected_width,
                    "height": int(expected_width * 1.5)  
                }

        if faces is None or len(faces) == 0:
            return {
                "success": False, 
                "message": "No face detected",
                "reference_box": reference_box if distance_measurement_active else None,
                "processed_image": create_processed_image(frame, None, quality=60)
            }

        face = max(faces, key=lambda x: x[2] * x[3])  
        x, y, fw, fh, confidence = map(float, face[:5])

        processed_image = create_processed_image(frame, faces, quality=60)

        if confidence >= 0.4:
            if calibration_active:
                focal = calibrate_focal_length(fw)
                calibration_active = False
                return {
                    "success": True, 
                    "message": "Calibration complete", 
                    "focal_length": focal,
                    "processed_image": processed_image
                }

            if distance_measurement_active and FOCAL_LENGTH:
                distance = calculate_distance(fw)
                return {
                    "success": True,
                    "faces": [{
                        "x": int(x), "y": int(y), "width": int(fw), "height": int(fh),
                        "confidence": round(confidence, 2), "distance": distance
                    }],
                    "focal_length": FOCAL_LENGTH,
                    "reference_box": reference_box,
                    "processed_image": processed_image
                }
            return {
                "success": True, 
                "message": "Face detected, but distance mode is off.",
                "processed_image": processed_image
            }

        return {"success": False, "message": "Face detected but confidence too low"}
    except Exception as e:
        logger.error(f"Error in processing: {e}")
        return {"error": str(e)}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global calibration_active, distance_measurement_active
    await websocket.accept()
    
    rate_limit = 0.05  
    last_process_time = 0
    
    while True:
        try:
            data = await websocket.receive_json()

            if "command" in data:
                cmd = data["command"]
                if cmd == "start_calibration":
                    calibration_active = True
                    distance_measurement_active = False
                    await websocket.send_json({"message": "Please stand at one-arm distance and click Capture"})
                elif cmd == "start_distance":
                    distance_measurement_active = True
                    calibration_active = False
                    await websocket.send_json({"message": "Distance measurement started. Try to fit your face in the red reference box (4m)"})
                elif cmd == "stop_all":
                    calibration_active = False
                    distance_measurement_active = False
                    await websocket.send_json({"message": "Measurement stopped"})
                elif cmd == "capture" and "image" in data:
                    response = await process_image(data["image"])
                    await websocket.send_json(response)
                continue

            if "image" in data:
                current_time = asyncio.get_event_loop().time()
                if current_time - last_process_time < rate_limit:
                    continue
                
                last_process_time = current_time
                response = await process_image(data["image"])
                await websocket.send_json(response)

        except Exception as e:
            logger.error(f"WebSocket error: {e}")
            break


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)