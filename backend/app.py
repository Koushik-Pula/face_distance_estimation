import base64
import cv2
import numpy as np
import os
import logging
import json
from datetime import timedelta
from fastapi import FastAPI, WebSocket, HTTPException, status, Depends, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer
import asyncio
from collections import deque
from dotenv import load_dotenv

# Auth imports
from auth import (
    authenticate_user, 
    create_access_token, 
    get_password_hash, 
    get_current_active_user,
    verify_websocket_token,
    ACCESS_TOKEN_EXPIRE_MINUTES
)
from models import UserCreate, UserLogin, Token, User, UserInDB
from database import users_collection, close_database_connection

# Load environment variables
load_dotenv()

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

app = FastAPI(title="Face Detection API with Authentication")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer()

# Face detection setup
MODEL_PATH = "face_detection_yunet_2023mar.onnx"
if not os.path.exists(MODEL_PATH):
    raise FileNotFoundError(f"Model file '{MODEL_PATH}' not found!")

face_detector = cv2.FaceDetectorYN.create(
    MODEL_PATH, "", (320, 320), score_threshold=0.4, nms_threshold=0.3, top_k=5000
)

KNOWN_FACE_WIDTH = 0.15  
FOCAL_LENGTH = None  
TARGET_DISTANCE = 4.0  
DISTANCE_THRESHOLD = 0.2  

calibration_active = False
distance_measurement_active = False
previous_distances = deque(maxlen=5)

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
    
    if len(previous_distances) >= 3:
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
    
    if distance_measurement_active and FOCAL_LENGTH:
        expected_face_width = calculate_expected_face_width_at_distance(TARGET_DISTANCE)
        if expected_face_width > 0:
            expected_face_height = int(expected_face_width * 1.5)
            
            ref_x = center_x - expected_face_width // 2
            ref_y = center_y - expected_face_height // 2
            
            box_color = (0, 255, 0) if is_at_target_distance(distance) else (0, 0, 255)
            box_thickness = 3 if is_at_target_distance(distance) else 2
            
            cv2.rectangle(output_frame, 
                         (ref_x, ref_y), 
                         (ref_x + expected_face_width, ref_y + expected_face_height), 
                         box_color, box_thickness)  

            if is_at_target_distance(distance):
                cv2.putText(output_frame, f"PERFECT! 4m REACHED", (ref_x, ref_y - 10), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, box_color, 2)
            else:
                cv2.putText(output_frame, f"4m Reference", (ref_x, ref_y - 10), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, box_color, 1)
    
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

# Authentication Routes
@app.post("/auth/register", response_model=Token)
async def register(user: UserCreate):
    # Check if user already exists
    existing_user = await users_collection.find_one({"email": user.email})
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Create new user
    hashed_password = get_password_hash(user.password)
    user_dict = user.dict()
    del user_dict['password']
    user_dict['hashed_password'] = hashed_password
    user_dict['is_active'] = True
    
    user_in_db = UserInDB(**user_dict)
    result = await users_collection.insert_one(user_in_db.dict(by_alias=True, exclude={"id"}))
    
    # Create access token
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.post("/auth/login", response_model=Token)
async def login(user_credentials: UserLogin):
    user = await authenticate_user(user_credentials.email, user_credentials.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/auth/me", response_model=User)
async def read_users_me(current_user: User = Depends(get_current_active_user)):
    return current_user

@app.get("/auth/protected")
async def protected_route(current_user: User = Depends(get_current_active_user)):
    return {"message": f"Hello {current_user.full_name}, this is a protected route!"}

# Protected WebSocket endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global calibration_active, distance_measurement_active
    
    # Wait for authentication token
    await websocket.accept()
    
    try:
        # First message should contain the authentication token
        auth_data = await websocket.receive_json()
        if "token" not in auth_data:
            await websocket.send_json({"error": "Authentication token required"})
            await websocket.close(code=1008)
            return
            
        user = await verify_websocket_token(auth_data["token"])
        if not user:
            await websocket.send_json({"error": "Invalid authentication token"})
            await websocket.close(code=1008)
            return
            
        await websocket.send_json({"message": f"Authenticated successfully as {user.full_name}"})
        
    except Exception as e:
        logger.error(f"Authentication error: {e}")
        await websocket.close(code=1008)
        return
    
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

        except WebSocketDisconnect:
            logger.info("WebSocket disconnected")
            break
        except Exception as e:
            logger.error(f"WebSocket error: {e}")
            break

# Health check endpoint (public)
@app.get("/health")
async def health_check():
    return {"status": "healthy"}

# Startup event
@app.on_event("startup")
async def startup_event():
    logger.info("Face Detection API with Authentication started")

# Shutdown event
@app.on_event("shutdown")
async def shutdown_event():
    await close_database_connection()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)