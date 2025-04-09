import React, { useState, useRef, useCallback, useEffect } from 'react';
import Webcam from 'react-webcam';

function App() {
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

    const webcamRef = useRef(null);
    const ws = useRef(null);
    const detectionInterval = useRef(null);
    const frameCountRef = useRef(0);
    const lastFrameTimeRef = useRef(Date.now());

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

        // Send regardless of previous request status
        ws.current.send(JSON.stringify({ image: imageSrc }));
        frameCountRef.current++;
    }, []);

    useEffect(() => {
        ws.current = new WebSocket("ws://localhost:8000/ws");

        ws.current.onopen = () => {
            setConnectionStatus('connected');
        };

        ws.current.onclose = () => {
            setConnectionStatus('disconnected');
        };

        ws.current.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.success) {
                if (data.processed_image) {
                    setProcessedImage(data.processed_image);
                }

                if (data.focal_length) {
                    setFocalLength(data.focal_length);
                }

                if (data.message?.toLowerCase().includes("calibration complete")) {
                    setIsCalibrating(false);
                    setIsCalibrated(true);
                    setStatusMessage("✅ Calibration complete! You can now measure distance.");
                }

                if (data.faces && data.faces.length > 0 && isMeasuring) {
                    setCurrentDistance(data.faces[0].distance > 0 ? `${data.faces[0].distance}m` : 'Calculating...');
                }
            }

            if (data.message) {
                setStatusMessage(data.message);
            }

            if (data.error) {
                console.error("Error:", data.error);
                setStatusMessage(`Error: ${data.error}`);
            }
        };

        ws.current.onerror = (error) => {
            console.error("WebSocket Error:", error);
            setConnectionStatus('error');
        };

        return () => {
            if (ws.current) ws.current.close();
        };
    }, [isMeasuring]);

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
            // Send both command and image for calibration
            ws.current.send(JSON.stringify({ 
                command: "capture", 
                image: imageSrc 
            }));
        }
    };

    const startMeasuringDistance = () => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            // Send the command to start distance measurement mode
            ws.current.send(JSON.stringify({ command: "start_distance" }));
            setIsMeasuring(true);
            // Higher frequency for better performance (100ms = up to 10 FPS)
            detectionInterval.current = setInterval(sendFrame, 100);
            setStatusMessage("📏 Measuring distance...");
        }
    };

    const stopMeasuringDistance = () => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            // Send the command to stop all measurements
            ws.current.send(JSON.stringify({ command: "stop_all" }));
        }
        if (detectionInterval.current) {
            clearInterval(detectionInterval.current);
            detectionInterval.current = null;
        }
        setIsMeasuring(false);
        setCurrentDistance('0m');
        setStatusMessage('Measurement stopped');
        setProcessedImage(null);
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (detectionInterval.current) {
                clearInterval(detectionInterval.current);
            }
        };
    }, []);

    return (
        <div className="min-h-screen bg-gray-100">
            <header className="bg-white shadow-md">
                <div className="container mx-auto px-4 py-6">
                    <h1 className="text-3xl font-bold text-gray-800">Face Detection App</h1>
                    <p className="mt-2 text-gray-600">Real-time face detection with distance measurement</p>
                    <p className={`mt-1 text-sm ${connectionStatus === 'connected' ? 'text-green-600' : 'text-red-600'}`}>
                        {connectionStatus === 'connected' ? 'Connected to server' : 'Not connected to server'}
                    </p>
                </div>
            </header>

            <main className="container mx-auto px-4 py-8">
                <div className="max-w-3xl mx-auto">
                    <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
                        <div className="relative aspect-video">
                            {showCamera && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <h3 className="text-gray-700 font-medium mb-2">Camera Input</h3>
                                        <Webcam
                                            ref={webcamRef}
                                            className="rounded-lg w-full"
                                            mirrored={true}
                                            screenshotFormat="image/jpeg"
                                            screenshotQuality={0.4}
                                            videoConstraints={{ 
                                                width: 320, 
                                                height: 240, 
                                                facingMode: "user" 
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <h3 className="text-gray-700 font-medium mb-2">Detection Result</h3>
                                        {processedImage ? (
                                            <img 
                                                src={processedImage} 
                                                alt="Processed Output" 
                                                className="rounded-lg w-full"
                                            />
                                        ) : (
                                            <div className="bg-gray-200 rounded-lg w-full h-full flex items-center justify-center">
                                                <p className="text-gray-500">Waiting for detection...</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {!showCamera && (
                                <div className="absolute inset-0 flex items-center justify-center bg-gray-100 rounded-lg">
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

                            {isCalibrated && !isMeasuring && (
                                <button onClick={startMeasuringDistance} className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-lg">
                                    Measure Distance
                                </button>
                            )}

                            {isMeasuring && (
                                <button onClick={stopMeasuringDistance} className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-lg">
                                    Stop Measuring
                                </button>
                            )}

                            <div className="flex items-center gap-2 bg-gray-50 px-4 py-2 rounded-lg">
                                <span className="text-gray-600">Current Distance:</span>
                                <span className="font-semibold text-gray-900">{currentDistance}</span>
                            </div>
                        </div>

                        {statusMessage && (
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
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default App;