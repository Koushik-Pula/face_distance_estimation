import React, { useState, useRef, useCallback, useEffect } from 'react';
import Webcam from 'react-webcam';
import LandoltC from './LandoltC';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import AuthModal from './components/AuthModal';

function FaceDetectionApp() {
    const [showCamera, setShowCamera] = useState(false);
    const [currentDistance, setCurrentDistance] = useState('0m');
    const [focalLength, setFocalLength] = useState(0.0);
    const [processedImage, setProcessedImage] = useState(null);
    const [connectionStatus, setConnectionStatus] = useState('disconnected');
    const [isCalibrating, setIsCalibrating] = useState(false);
    const [isCalibrated, setIsCalibrated] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const [isMeasuring, setIsMeasuring] = useState(false);
    const [fps, setFps] = useState(0);
    const [referenceBox, setReferenceBox] = useState(null);
    const [atTargetDistance, setAtTargetDistance] = useState(false);
    const [isDistanceReached, setIsDistanceReached] = useState(false);
    const [lastFaceDetected, setLastFaceDetected] = useState(Date.now());
    const [showAuthModal, setShowAuthModal] = useState(false);
    
    // New state variables for countdown and Landolt C test
    const [showCountdown, setShowCountdown] = useState(false);
    const [countdownValue, setCountdownValue] = useState(5);
    const [showLandoltTest, setShowLandoltTest] = useState(false);

    const { user, logout, token } = useAuth();
    const webcamRef = useRef(null);
    const ws = useRef(null);
    const detectionInterval = useRef(null);
    const frameCountRef = useRef(0);
    const lastFrameTimeRef = useRef(Date.now());
    const consecutiveTargetFrames = useRef(0);
    const framesSinceLastFace = useRef(0);
    const countdownTimerRef = useRef(null);
    const authSentRef = useRef(false);

    // FPS calculation
    useEffect(() => {
        const fpsInterval = setInterval(() => {
            const now = Date.now();
            const elapsed = (now - lastFrameTimeRef.current) / 1000;
            if (elapsed > 0) {
                setFps(Math.round(frameCountRef.current / elapsed));
                frameCountRef.current = 0;
                lastFrameTimeRef.current = now;
            }
        }, 1000);

        return () => clearInterval(fpsInterval);
    }, []);

    const sendFrame = useCallback(() => {
        if (!webcamRef.current || !ws.current || ws.current.readyState !== WebSocket.OPEN) return;

        const imageSrc = webcamRef.current.getScreenshot();
        if (!imageSrc) return;

        ws.current.send(JSON.stringify({ image: imageSrc }));
        frameCountRef.current++;
        
        if (isDistanceReached && (Date.now() - lastFaceDetected > 5000)) {
            framesSinceLastFace.current++;
            if (framesSinceLastFace.current > 10) {
                setStatusMessage("✅ Distance measurement complete! 4m distance reached and verified.");
                stopMeasuringDistance();
            }
        }
    }, [isDistanceReached, lastFaceDetected]);

    useEffect(() => {
        if (!token) {
            console.log("No token available for WebSocket connection");
            return;
        }

        const storedToken = localStorage.getItem('authToken');
        console.log("WebSocket using token:", storedToken || token);
        
        // Connect to WebSocket using the appropriate path
        ws.current = new WebSocket(`ws://${window.location.host}/ws`);
        console.log("Attempting WebSocket connection to:", `ws://${window.location.host}/ws`);

        ws.current.onopen = () => {
            console.log("WebSocket connection established");
            setConnectionStatus('connected');
            
            // Send authentication token immediately when connection opens
            const storedToken = localStorage.getItem('authToken');
            const tokenToSend = storedToken || token;
            console.log("Sending authentication token to WebSocket:", tokenToSend);
            ws.current.send(JSON.stringify({ token: tokenToSend }));
            authSentRef.current = true;
        };

        ws.current.onclose = (event) => {
            console.log("WebSocket closed with code:", event.code);
            setConnectionStatus('disconnected');
            authSentRef.current = false;
        };

        ws.current.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.error) {
                console.error("WebSocket Error:", data.error);
                setStatusMessage(`Error: ${data.error}`);
                if (data.error.includes('Authentication')) {
                    logout();
                }
                return;
            }

            if (data.success) {
                if (data.processed_image) {
                    setProcessedImage(data.processed_image);
                }

                if (data.focal_length) {
                    setFocalLength(data.focal_length);
                }

                if (data.reference_box) {
                    setReferenceBox(data.reference_box);
                }

                if (data.message?.toLowerCase().includes("calibration complete")) {
                    setIsCalibrating(false);
                    setIsCalibrated(true);
                    setStatusMessage("✅ Calibration complete! You can now measure distance.");
                }

                if (data.face_detected) {
                    setLastFaceDetected(Date.now());
                    framesSinceLastFace.current = 0;
                }

                if (data.faces && data.faces.length > 0 && isMeasuring) {
                    const distance = data.faces[0].distance;
                    setCurrentDistance(distance > 0 ? `${distance}m` : 'Calculating...');
                    
                    if (data.at_target_distance) {
                        setAtTargetDistance(true);
                        consecutiveTargetFrames.current++;
                        
                        if (consecutiveTargetFrames.current >= 15 && !isDistanceReached) {
                            setIsDistanceReached(true);
                            setStatusMessage("🎯 Perfect! You've reached the 4m distance! Starting countdown for vision test...");
                            startCountdown();
                        }
                    } else {
                        setAtTargetDistance(false);
                        consecutiveTargetFrames.current = 0;
                    }
                }
            }

            if (data.message && !data.message.includes('Authenticated successfully')) {
                setStatusMessage(data.message);
            }
        };

        ws.current.onerror = (error) => {
            console.error("WebSocket Error:", error);
            setConnectionStatus('error');
            setStatusMessage("⚠️ Error connecting to server. Check if backend is running on port 8000.");
        };
        
        ws.current.onclose = (event) => {
            console.log("WebSocket connection closed:", event.code, event.reason);
            setConnectionStatus('disconnected');
            authSentRef.current = false;
        };

        return () => {
            if (ws.current) {
                ws.current.close();
            }
        };
    }, [isMeasuring, isDistanceReached, token, logout]);

    const startCountdown = () => {
        stopMeasuringDistance();
        
        setShowCountdown(true);
        setCountdownValue(5);
        
        if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current);
        }
        
        countdownTimerRef.current = setInterval(() => {
            setCountdownValue(prev => {
                if (prev <= 1) {
                    clearInterval(countdownTimerRef.current);
                    setShowCountdown(false);
                    setShowLandoltTest(true);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    };

    const startCalibration = () => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify({ command: "start_calibration" }));
            setIsCalibrating(true);
            setIsCalibrated(false);
            setShowCamera(true);
            setStatusMessage("🧍 Stand at one-arm distance and click 'Capture'");
        }
    };

    const captureCalibration = () => {
        const imageSrc = webcamRef.current?.getScreenshot();
        if (imageSrc && ws.current && ws.current.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify({ 
                command: "capture", 
                image: imageSrc 
            }));
        }
    };

    const startMeasuringDistance = () => {
        setIsDistanceReached(false);
        setAtTargetDistance(false);
        setShowCountdown(false);
        consecutiveTargetFrames.current = 0;
        framesSinceLastFace.current = 0;
        
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify({ command: "start_distance" }));
            setIsMeasuring(true);
            detectionInterval.current = setInterval(sendFrame, 100);
            setStatusMessage("📏 Measuring distance... Try to fit your face in the red reference box at 4m");
        }
    };

    const stopMeasuringDistance = () => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify({ command: "stop_all" }));
        }
        if (detectionInterval.current) {
            clearInterval(detectionInterval.current);
            detectionInterval.current = null;
        }
        setIsMeasuring(false);
    };
    
    const closeLandoltTest = () => {
        setShowLandoltTest(false);
    };

    useEffect(() => {
        return () => {
            if (detectionInterval.current) {
                clearInterval(detectionInterval.current);
            }
            if (countdownTimerRef.current) {
                clearInterval(countdownTimerRef.current);
            }
        };
    }, []);

    return (
        <div className="min-h-screen bg-gray-100">
            <header className="bg-white shadow-md">
                <div className="container mx-auto px-4 py-6">
                    <div className="flex justify-between items-center">
                        <div>
                            <h1 className="text-3xl font-bold text-gray-800">Face Detection App</h1>
                            <p className="mt-2 text-gray-600">Real-time face detection with distance measurement</p>
                            <p className={`mt-1 text-sm ${connectionStatus === 'connected' ? 'text-green-600' : 'text-red-600'}`}>
                                {connectionStatus === 'connected' ? 'Connected to server' : 'Not connected to server'}
                            </p>
                        </div>
                        <div className="flex items-center space-x-4">
                            {user && (
                                <>
                                    <span className="text-gray-700">Welcome, {user.full_name}!</span>
                                    <button
                                        onClick={() => setShowAuthModal(true)}
                                        className="text-blue-600 hover:text-blue-700"
                                    >
                                        Account
                                    </button>
                                    <button
                                        onClick={logout}
                                        className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg"
                                    >
                                        Logout
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-4 py-8">
                <div className="max-w-4xl mx-auto">
                    <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
                        {showCountdown && (
                            <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-75 z-50">
                                <div className="bg-white rounded-xl p-10 text-center shadow-2xl">
                                    <h2 className="text-3xl font-bold mb-4">Preparing Vision Test</h2>
                                    <p className="text-xl mb-6">Starting in...</p>
                                    <div className="text-6xl font-bold text-blue-600">{countdownValue}</div>
                                </div>
                            </div>
                        )}
                        
                        {showLandoltTest && (
                            <LandoltC onClose={closeLandoltTest} />
                        )}
                        
                        {isMeasuring && (
                            <div className={`mb-4 p-3 rounded-lg text-center ${
                                isDistanceReached ? 'bg-green-500 text-white' : 
                                atTargetDistance ? 'bg-yellow-500 text-white' : 'bg-gray-200'
                            }`}>
                                {isDistanceReached ? (
                                    <span className="text-lg font-bold">✅ 4m DISTANCE REACHED!</span>
                                ) : atTargetDistance ? (
                                    <span className="text-lg font-bold">Almost there! Hold position...</span>
                                ) : (
                                    <span className="text-gray-600">Move until you reach 4m</span>
                                )}
                            </div>
                        )}
                        
                        <div className="relative">
                            {showCamera && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="col-span-1 md:col-span-2">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="w-full">
                                                <h3 className="text-gray-700 font-medium mb-2">Camera Input</h3>
                                                <Webcam
                                                    ref={webcamRef}
                                                    className="rounded-lg w-full"
                                                    mirrored={true}
                                                    screenshotFormat="image/jpeg"
                                                    screenshotQuality={0.4}
                                                    videoConstraints={{ 
                                                        width: 640, 
                                                        height: 480, 
                                                        facingMode: "user" 
                                                    }}
                                                />
                                            </div>
                                            <div className="w-full">
                                                <h3 className="text-gray-700 font-medium mb-2">Detection Result</h3>
                                                {processedImage ? (
                                                    <img 
                                                        src={processedImage} 
                                                        alt="Processed Output" 
                                                        className="rounded-lg w-full"
                                                    />
                                                ) : (
                                                    <div className="bg-gray-200 rounded-lg w-full h-full flex items-center justify-center" style={{minHeight: "480px"}}>
                                                        <p className="text-gray-500">Waiting for detection...</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {!showCamera && (
                                <div className="flex items-center justify-center bg-gray-100 rounded-lg" style={{height: "300px"}}>
                                    <p className="text-gray-600">Camera will appear after clicking Calibrate</p>
                                </div>
                            )}
                        </div>

                        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
                            {!isCalibrated && !isCalibrating && (
                                <button onClick={startCalibration} className="bg-yellow-500 hover:bg-yellow-600 text-white px-6 py-2 rounded-lg">
                                    Calibrate
                                </button>
                            )}

                            {isCalibrating && (
                                <button onClick={captureCalibration} className="bg-purple-500 hover:bg-purple-600 text-white px-6 py-2 rounded-lg">
                                    Capture
                                </button>
                            )}

                            {isCalibrated && !isMeasuring && !showCountdown && !showLandoltTest && (
                                <button onClick={startMeasuringDistance} className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-lg">
                                    Measure Distance
                                </button>
                            )}

                            {isMeasuring && (
                                <button onClick={stopMeasuringDistance} className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-lg">
                                    Stop Measuring
                                </button>
                            )}

                            {isDistanceReached && !isMeasuring && !showCountdown && !showLandoltTest && (
                                <button onClick={startMeasuringDistance} className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-lg">
                                    Measure Again
                                </button>
                            )}

                            <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
                                isDistanceReached ? 'bg-green-100 text-green-800' : 'bg-gray-50 text-gray-600'
                            }`}>
                                <span>Current Distance:</span>
                                <span className="font-semibold text-lg">{currentDistance}</span>
                            </div>
                        </div>

                        {statusMessage && !showCountdown && !showLandoltTest && (
                            <div className="mt-4 p-3 bg-yellow-100 text-yellow-800 rounded-lg">
                                {statusMessage}
                            </div>
                        )}

                        <div className="mt-4 flex flex-wrap gap-4 bg-gray-50 p-3 rounded-lg">
                            <div className="flex items-center gap-2">
                                <span className="text-gray-600">Focal Length:</span>
                                <span className="font-mono">{focalLength.toFixed(1)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-gray-600">FPS:</span>
                                <span className="font-mono">{fps}</span>
                            </div>
                            {isMeasuring && referenceBox && (
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-600">Reference Box (4m):</span>
                                    <span className="font-mono">{referenceBox.width}x{referenceBox.height}px</span>
                                </div>
                            )}
                        </div>
                    </div>
                    
                    <div className="bg-white rounded-lg shadow-lg p-6">
                        <h2 className="text-xl font-bold mb-4">About This Application</h2>
                        <p className="mb-3">
                            This application combines face detection with distance measurement to assist in conducting a standardized vision test.
                        </p>
                        <h3 className="font-bold mt-4">How It Works:</h3>
                        <ol className="list-decimal pl-6 mt-2 space-y-2">
                            <li>First, <strong>calibrate</strong> the system by standing at one arm's length (about 70cm) from your camera.</li>
                            <li>After calibration, use the <strong>Measure Distance</strong> button to begin tracking your position.</li>
                            <li>Move back until your face fits within the reference box (approximately 4 meters).</li>
                            <li>Once you maintain the correct distance for 1.5 seconds, the Landolt C vision test will automatically begin.</li>
                        </ol>
                        <p className="mt-4 text-gray-600">
                            Note: For accurate results, please ensure good lighting conditions and a clear view of your face.
                        </p>
                    </div>
                </div>
            </main>
            
            <footer className="bg-gray-800 text-white py-6 mt-8">
                <div className="container mx-auto px-4">
                    <p className="text-center">© 2025 Vision Testing Application</p>
                </div>
            </footer>

            <AuthModal 
                isOpen={showAuthModal} 
                onClose={() => setShowAuthModal(false)} 
            />
        </div>
    );
}

function App() {
    return (
        <AuthProvider>
            <ProtectedRoute>
                <FaceDetectionApp />
            </ProtectedRoute>
        </AuthProvider>
    );
}

export default App;