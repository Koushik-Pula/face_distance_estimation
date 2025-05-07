# Face Detection App

This is a simple face detection app built with React + Vite on the frontend and Python on the backend.

## Project Structure

```
face-detection-app/
├── backend/
│   └── app.py         # Python backend server
├── src/
│   └── App.jsx 
|   |__ LandoltC.jsx      # Main React component
├── package.json       # Frontend configuration
└── README.md
```


## Prerequisites

- Node.js and npm installed
- Python installed

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/face-detection-app.git
cd face-detection-app
```

## Frontend Setup (React + Vite)

### Install Dependencies

```bash
npm install
```

### Start the Frontend Server

In Terminal 1, run:

```bash
npm run dev
```

This will start the React development server at:

http://localhost:5173

## Backend Setup (Python)

Make sure you have Python installed.

### Navigate to the backend folder

```bash
cd backend
```

### (Optional) Create and activate virtual environment

```bash
python -m venv venv
source venv/bin/activate      # On Windows: venv\Scripts\activate
```

### Install dependencies

If you're using Flask:

```bash
pip install flask
```

If you're using FastAPI and Uvicorn:

```bash
pip install fastapi uvicorn
```

### Run the Backend Server

In Terminal 2, run:

```bash
python app.py                # For Flask

```

Backend will be running on:

- Flask: http://localhost:5000
- FastAPI: http://localhost:8000


## Ready

- Frontend: http://localhost:5173
- Backend: http://localhost:5000 or http://localhost:8000

Start both servers in separate terminals and begin using the app.

