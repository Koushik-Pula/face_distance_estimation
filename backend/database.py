import os
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017/face_detection_db")

# Async client for FastAPI
motor_client = AsyncIOMotorClient(MONGODB_URL)
database = motor_client.get_default_database()

# Collections
users_collection = database.users

# Sync client for testing/initialization
sync_client = MongoClient(MONGODB_URL)
sync_db = sync_client.get_default_database()

async def close_database_connection():
    motor_client.close()