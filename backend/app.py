import base64
import cv2
import numpy as np
import os
import logging
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
import asyncio
from collections import deque

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
DISTANCE_THRESHOLD = 0.2  # Consider within 20cm of target as "at target distance"

calibration_active = False
distance_measurement_active = False
previous_distances = deque(maxlen=5)  # Store recent distance measurements for smoothing

def calculate_distance(face_width):
    return round((KNOWN_FACE_WIDTH * FOCAL_LENGTH) / face_width, 2) if FOCAL_LENGTH and face_width > 0 else -1

def calculate_expected_face_width_at_distance(distance):
    return int((KNOWN_FACE_WIDTH * FOCAL_LENGTH) / distance) if FOCAL_LENGTH else 0

def calibrate_focal_length(face_width, known_distance=0.7):
    global FOCAL_LENGTH
    FOCAL_LENGTH = (face_width * known_distance) / KNOWN_FACE_WIDTH
    logger.info(f"Focal length calibrated: {FOCAL_LENGTH}")
    return FOCAL_LENGTH

def smooth_distance(new_distance):
    """Apply smoothing to distance measurements to reduce fluctuations"""
    if new_distance <= 0:
        return new_distance
        
    previous_distances.append(new_distance)
    
    # More weight to closer distances for safety
    if len(previous_distances) >= 3:
        # Sort distances and take the median
        sorted_distances = sorted(previous_distances)
        return sorted_distances[len(sorted_distances) // 2]
    
    return new_distance

def is_at_target_distance(distance):
    """Check if current distance is approximately at target distance"""
    return abs(distance - TARGET_DISTANCE) <= DISTANCE_THRESHOLD

def create_processed_image(frame, faces, distance=-1, quality=70):
    """Draw face detection results on the image and convert back to base64 with specified quality"""
    output_frame = frame.copy()
    height, width = output_frame.shape[:2]
    center_x, center_y = width // 2, height // 2
    
    # Always draw a reference box for 4m if we have a calibrated focal length
    if distance_measurement_active and FOCAL_LENGTH:
        expected_face_width = calculate_expected_face_width_at_distance(TARGET_DISTANCE)
        if expected_face_width > 0:
            expected_face_height = int(expected_face_width * 1.5)
            
            ref_x = center_x - expected_face_width // 2
            ref_y = center_y - expected_face_height // 2
            
            # Draw reference box - red normally, green when at target distance
            box_color = (0, 255, 0) if is_at_target_distance(distance) else (0, 0, 255)
            box_thickness = 3 if is_at_target_distance(distance) else 2
            
            cv2.rectangle(output_frame, 
                         (ref_x, ref_y), 
                         (ref_x + expected_face_width, ref_y + expected_face_height), 
                         box_color, box_thickness)  

            # Add different text depending on if target is reached
            if is_at_target_distance(distance):
                cv2.putText(output_frame, f"PERFECT! 4m REACHED", (ref_x, ref_y - 10), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, box_color, 2)
            else:
                cv2.putText(output_frame, f"4m Reference", (ref_x, ref_y - 10), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, box_color, 1)
    
    # Draw detected faces
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
                    # Use blue normally, green when at target distance
                    color = (0, 255, 0) if is_at_target_distance(distance) else (255, 0, 0)
                    thickness = 2 if is_at_target_distance(distance) else 1
                    
                    distance_text = f"{distance}m"
                    if is_at_target_distance(distance):
                        distance_text = f"{distance}m ✓"
                        
                    cv2.putText(output_frame, distance_text, (x, y + h + 20), 
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, thickness)
    
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

        # No face detected case - still return processed image with reference box
        if faces is None or len(faces) == 0:
            return {
                "success": False, 
                "message": "No face detected",
                "reference_box": reference_box if distance_measurement_active else None,
                "processed_image": create_processed_image(frame, None, quality=60),
                "face_detected": False
            }

        face = max(faces, key=lambda x: x[2] * x[3])  
        x, y, fw, fh, confidence = map(float, face[:5])

        if confidence >= 0.4:
            if calibration_active:
                focal = calibrate_focal_length(fw)
                calibration_active = False
                return {
                    "success": True, 
                    "message": "Calibration complete", 
                    "focal_length": focal,
                    "processed_image": create_processed_image(frame, faces, quality=60),
                    "face_detected": True
                }

            if distance_measurement_active and FOCAL_LENGTH:
                raw_distance = calculate_distance(fw)
                smoothed_distance = smooth_distance(raw_distance)
                
                # Check if at target distance
                at_target = is_at_target_distance(smoothed_distance)
                
                return {
                    "success": True,
                    "faces": [{
                        "x": int(x), "y": int(y), "width": int(fw), "height": int(fh),
                        "confidence": round(confidence, 2), 
                        "distance": smoothed_distance
                    }],
                    "focal_length": FOCAL_LENGTH,
                    "reference_box": reference_box,
                    "processed_image": create_processed_image(frame, faces, smoothed_distance, quality=60),
                    "face_detected": True,
                    "at_target_distance": at_target
                }
            
            return {
                "success": True, 
                "message": "Face detected, but distance mode is off.",
                "processed_image": create_processed_image(frame, faces, quality=60),
                "face_detected": True
            }

        return {
            "success": False, 
            "message": "Face detected but confidence too low",
            "processed_image": create_processed_image(frame, None, quality=60),
            "face_detected": False
        }
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