import React, { useState, useEffect, useRef } from 'react';

const LandoltC = ({ onClose }) => {
  const canvasRef = useRef(null);
  const [pixelsPerMm, setPixelsPerMm] = useState(null);
  const [setupMode, setSetupMode] = useState(true);
  const [referenceLength, setReferenceLength] = useState(100);
  const [referenceObject, setReferenceObject] = useState('credit-card');
  
  // Visual acuity levels in 6/X notation (order from best to worst)
  const ACUITY_LEVELS = [
    '6/1.5', '6/2', '6/3', '6/4', '6/5', '6/6', '6/8', '6/10', 
    '6/12', '6/16', '6/18', '6/20', '6/24', '6/36', '6/60'
  ];
  
  // Convert acuity to numerical value for comparisons (larger number = worse vision)
  const acuityToNumber = (acuity) => {
    const value = parseFloat(acuity.split('/')[1]);
    return value;
  };
  
  // Convert numerical value back to acuity string
  const numberToAcuity = (value) => {
    return `6/${value}`;
  };
  
  // Define starting index (6/6)
  const startingIndex = ACUITY_LEVELS.indexOf('6/6');
  
  // Test state
  const [currentAcuityIndex, setCurrentAcuityIndex] = useState(startingIndex);
  const [testDirection, setTestDirection] = useState(null); // null = initial, "better" or "worse"
  const [testHistory, setTestHistory] = useState([]);
  const [testComplete, setTestComplete] = useState(false);
  const [finalAcuity, setFinalAcuity] = useState(null);
  const [refinementMode, setRefinementMode] = useState(false);
  const [refinementPairs, setRefinementPairs] = useState([]);
  const [currentRefinementIndex, setCurrentRefinementIndex] = useState(0);
  const [viewingDistance, setViewingDistance] = useState(400); // in cm
  
  
  const SYMBOLS_PER_ROW = 5;
  
  
  const [chartPattern, setChartPattern] = useState([]);

  
  const referenceObjects = {
    'credit-card': { name: 'Credit Card', width: 85.6 },
    'a4-paper': { name: 'A4 Paper', width: 210 },
    'dollar-bill': { name: 'Dollar Bill', width: 155.96 },
    'custom': { name: 'Custom', width: 100 }
  };

  
  const getAcuitySizeInMm = (acuityStr) => {
    const standardSize = Math.tan((5/60) * (Math.PI/180)) * 2 * (viewingDistance * 10); // size in mm at 6/6 vision at given distance
    const acuityRatio = acuityToNumber(acuityStr) / acuityToNumber('6/6');
    return standardSize * acuityRatio;
  };

  
  const getRandomOrientation = () => {
    const orientations = ['right', 'left', 'top', 'bottom'];
    return orientations[Math.floor(Math.random() * orientations.length)];
  };

  
  const generateRowPattern = () => {
    const rowPattern = [];
    for (let j = 0; j < SYMBOLS_PER_ROW; j++) {
      rowPattern.push(getRandomOrientation());
    }
    return rowPattern;
  };

  
  useEffect(() => {
    setChartPattern(generateRowPattern());
  }, [currentAcuityIndex, refinementMode, currentRefinementIndex]);
  
  
  const getLandoltCSize = (acuityStr = null) => {
    if (!pixelsPerMm) return 60; 
    
  
    const currentAcuity = acuityStr || (refinementMode 
      ? refinementPairs[currentRefinementIndex]
      : ACUITY_LEVELS[currentAcuityIndex]);
    
   
    const sizeInMm = getAcuitySizeInMm(currentAcuity);
    return sizeInMm * pixelsPerMm;
  };
  
  
  const drawCalibrationScreen = (ctx, width, height) => {
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height);
    
    const objectWidth = referenceObject === 'custom' 
      ? referenceLength 
      : referenceObjects[referenceObject].width;
    
    const pixelWidth = objectWidth * (pixelsPerMm || 3);
    
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 2;
    ctx.strokeRect((width - pixelWidth) / 2, height / 2 - 50, pixelWidth, pixelWidth * 0.63);
    
    ctx.font = '20px sans-serif';
    ctx.fillStyle = 'black';
    ctx.textAlign = 'center';
    ctx.fillText('Adjust the slider until the rectangle matches your reference object', width / 2, height / 2 + 100);
    ctx.fillText(`(${referenceObjects[referenceObject].name})`, width / 2, height / 2 + 130);
  };
  
  
  const drawStandardLandoltC = (ctx, x, y, size, orientation) => {
    const diameter = size;
    const strokeWidth = diameter / 5; 
    const radius = diameter / 2;
    const gapAngleSize = Math.PI/12; 
    
    ctx.strokeStyle = 'black';
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    
    let startAngle, endAngle;
    
    switch(orientation) {
      case 'right':
        startAngle = -gapAngleSize;
        endAngle = gapAngleSize;
        break;
      case 'left':
        startAngle = Math.PI - gapAngleSize;
        endAngle = Math.PI + gapAngleSize;
        break;
      case 'top':
        startAngle = Math.PI * 3/2 - gapAngleSize;
        endAngle = Math.PI * 3/2 + gapAngleSize;
        break;
      case 'bottom':
        startAngle = Math.PI/2 - gapAngleSize;
        endAngle = Math.PI/2 + gapAngleSize;
        break;
      default:
        startAngle = 0;
        endAngle = 0;
    }
    
    ctx.arc(x, y, radius - strokeWidth/2, endAngle, startAngle + Math.PI*2, false);
    ctx.stroke();
  };
  
  
  const drawLandoltCRow = (ctx, width, height) => {
    const size = getLandoltCSize();
    const orientations = chartPattern;
    
    const rowY = height / 2;
    
    const spacing = Math.max(size * 1.5, 40); // More spacing for larger symbols, minimum 40px
    const totalWidth = SYMBOLS_PER_ROW * spacing;
    const startX = (width - totalWidth) / 2 + spacing / 2;
    
    // Draw each symbol in the row
    for (let i = 0; i < SYMBOLS_PER_ROW; i++) {
      const x = startX + i * spacing;
      drawStandardLandoltC(ctx, x, rowY, size, orientations[i]);
    }
    
    // Draw the current acuity level
    ctx.font = '18px sans-serif';
    ctx.fillStyle = 'black';
    ctx.textAlign = 'left';
    ctx.fillText(
      refinementMode ? refinementPairs[currentRefinementIndex] : ACUITY_LEVELS[currentAcuityIndex], 
      width - 70, 
      height - 70
    );

    // Draw the recommended viewing distance
    ctx.font = '16px sans-serif';
    ctx.fillStyle = 'blue';
    ctx.textAlign = 'left';
    ctx.fillText(`Viewing distance: ${viewingDistance} cm`, 20, height - 70);
  };
  
  // Draw the entire chart (all rows visible) for final results
  const drawFullChart = (ctx, width, height) => {
    // Sort the test history by acuity value
    const sortedHistory = [...testHistory].sort((a, b) => {
      return acuityToNumber(a.acuity) - acuityToNumber(b.acuity);
    });
    
    // Calculate the vertical spacing between rows
    const totalHeight = height * 0.8;
    const rowHeight = Math.min(totalHeight / Math.max(sortedHistory.length - 1, 1), 50);
    
    // Draw each row from the test history
    for (let i = 0; i < sortedHistory.length; i++) {
      const entry = sortedHistory[i];
      const rowY = height * 0.1 + i * rowHeight;
      
      // Calculate size based on acuity
      const size = getLandoltCSize(entry.acuity);
      
      // Calculate horizontal spacing
      const spacing = Math.max(size * 1.5, 40);
      const startX = width / 2 - size;
      
      // Draw symbol representation
      drawStandardLandoltC(ctx, startX, rowY, size, 'right');
      
      // Draw the acuity level and result
      ctx.font = '16px sans-serif';
      ctx.fillStyle = entry.couldSee ? 'green' : 'red';
      ctx.textAlign = 'left';
      ctx.fillText(`${entry.acuity} - ${entry.couldSee ? 'Visible' : 'Not visible'}`, startX + size * 1.5, rowY + 5);
    }
  };

  // Draw the canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear canvas
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height);
    
    if (setupMode) {
      drawCalibrationScreen(ctx, width, height);
    } else if (!testComplete && chartPattern.length > 0) {
      // Draw the current row
      drawLandoltCRow(ctx, width, height);
      
      // Add instructions
      ctx.font = '20px sans-serif';
      ctx.fillStyle = 'black';
      ctx.textAlign = 'center';
      ctx.fillText('Identify the direction of the gaps in the symbols', width / 2, height - 40);
    } else if (testComplete) {
      // Draw test summary when test is complete
      drawFullChart(ctx, width, height);
      
      // Display final result
      ctx.fillStyle = 'rgba(240, 240, 240, 0.9)';
      ctx.fillRect(width / 2 - 200, height / 2 - 50, 400, 100);
      
      ctx.font = '24px sans-serif';
      ctx.fillStyle = 'black';
      ctx.textAlign = 'center';
      ctx.fillText(`Your visual acuity is approximately: ${finalAcuity}`, width / 2, height / 2);
    }
  }, [setupMode, currentAcuityIndex, chartPattern, testComplete, finalAcuity, testHistory, refinementMode, currentRefinementIndex, refinementPairs, pixelsPerMm, referenceObject, referenceLength, viewingDistance]);

  // Find intermediate acuity value between two levels
  const findIntermediateLevel = (level1, level2) => {
    const value1 = acuityToNumber(level1);
    const value2 = acuityToNumber(level2);
    
    // Find standard acuity level between these two if possible
    for (let i = 0; i < ACUITY_LEVELS.length; i++) {
      const value = acuityToNumber(ACUITY_LEVELS[i]);
      if ((value > value1 && value < value2) || (value < value1 && value > value2)) {
        return ACUITY_LEVELS[i];
      }
    }
    
    return level1; // If no intermediate level found, return the first one
  };

  // Create refinement pairs between visible and not visible thresholds
  const createRefinementPairs = (visibleAcuity, invisibleAcuity) => {
    const visibleValue = acuityToNumber(visibleAcuity);
    const invisibleValue = acuityToNumber(invisibleAcuity);
    
    // Find the standard acuity levels between these two
    const intermediateLevels = ACUITY_LEVELS.filter(level => {
      const value = acuityToNumber(level);
      return (visibleValue < invisibleValue) 
        ? (value > visibleValue && value < invisibleValue) 
        : (value < visibleValue && value > invisibleValue);
    });
    
    // If there are intermediate levels, test those
    if (intermediateLevels.length > 0) {
      return intermediateLevels;
    }
    
    return []; // No intermediate levels found
  };

  
  const determineNextAcuityLevel = (couldSee) => {
 
    if (refinementMode) {
      const currentAcuity = refinementPairs[currentRefinementIndex];
      setTestHistory([...testHistory, { acuity: currentAcuity, couldSee }]);
      
      if (currentRefinementIndex < refinementPairs.length - 1) {
        setCurrentRefinementIndex(currentRefinementIndex + 1);
      } else {
        const allResults = [...testHistory, { acuity: currentAcuity, couldSee }];
        
        const bestVisibleAcuity = allResults
          .filter(result => result.couldSee)
          .sort((a, b) => acuityToNumber(a.acuity) - acuityToNumber(b.acuity))[0];
        
        setFinalAcuity(bestVisibleAcuity ? bestVisibleAcuity.acuity : ACUITY_LEVELS[ACUITY_LEVELS.length - 1]);
        setTestComplete(true);
      }
      return;
    }
    
    // Record the current standard test result
    const currentAcuity = ACUITY_LEVELS[currentAcuityIndex];
    setTestHistory([...testHistory, { acuity: currentAcuity, couldSee }]);
    
    
    if (testDirection === null) {
      if (couldSee) {
        // If they can see 6/6, test better vision (move toward 6/1.5)
        setTestDirection("better");
        setCurrentAcuityIndex(currentAcuityIndex - 1);
      } else {
        // If they can't see 6/6, test worse vision (move toward 6/60)
        setTestDirection("worse");
        setCurrentAcuityIndex(currentAcuityIndex + 1);
      }
      return;
    }
    
    // For subsequent tests, follow binary search-like approach
    if (testDirection === "better") {
      if (couldSee) {
        // If they can see, go to even better level (if available)
        if (currentAcuityIndex > 0) {
          setCurrentAcuityIndex(currentAcuityIndex - 1);
        } else {
          // At best level (6/1.5) and can see, end test
          setFinalAcuity(ACUITY_LEVELS[0]);
          setTestComplete(true);
        }
      } else {
  
        const previousIndex = currentAcuityIndex + 1;
        const invisibleAcuity = ACUITY_LEVELS[currentAcuityIndex];
        const visibleAcuity = ACUITY_LEVELS[previousIndex];
        
        // Check if there's a big gap between levels that needs refinement
        const refinements = createRefinementPairs(visibleAcuity, invisibleAcuity);
        
        if (refinements.length > 0) {
          // Enter refinement mode
          setRefinementMode(true);
          setRefinementPairs(refinements);
          setCurrentRefinementIndex(0);
        } else {
          // No refinement needed
          setFinalAcuity(visibleAcuity);
          setTestComplete(true);
        }
      }
    } else if (testDirection === "worse") {
      if (couldSee) {

        setFinalAcuity(ACUITY_LEVELS[currentAcuityIndex]);
        setTestComplete(true);
      } else {
        // If they can't see, go to even worse level (if available)
        if (currentAcuityIndex < ACUITY_LEVELS.length - 1) {
          setCurrentAcuityIndex(currentAcuityIndex + 1);
        } else {
          // At worst level (6/60) and can't see, end test
          setFinalAcuity(ACUITY_LEVELS[ACUITY_LEVELS.length - 1]);
          setTestComplete(true);
        }
      }
    }
  };

  // Handle user response
  const handleResponse = (couldSee) => {
    if (testComplete) return;
    determineNextAcuityLevel(couldSee);
  };

  // Restart the test
  const handleRestart = () => {
    setCurrentAcuityIndex(startingIndex);
    setTestDirection(null);
    setTestHistory([]);
    setTestComplete(false);
    setFinalAcuity(null);
    setRefinementMode(false);
    setRefinementPairs([]);
    setCurrentRefinementIndex(0);
    setChartPattern(generateRowPattern());
  };

  // Complete calibration and start test
  const handleCompleteSetup = () => {
    setSetupMode(false);
  };

  // Update the pixels per mm value based on reference object
  const handleCalibrationChange = (value) => {
    const objectWidth = referenceObject === 'custom' 
      ? referenceLength 
      : referenceObjects[referenceObject].width;
    
    // Calculate pixels per mm
    setPixelsPerMm(value / objectWidth);
  };

  return (
    <div className="fixed inset-0 bg-white flex flex-col items-center justify-center z-50">
      {/* Close button in the top-right corner */}
      <button 
        onClick={onClose}
        className="absolute top-4 right-4 bg-red-500 hover:bg-red-600 text-white rounded-full w-10 h-10 flex items-center justify-center"
      >
        X
      </button>
      
      {/* Test information */}
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-bold mb-2">Landolt C Visual Acuity Test</h2>
        {setupMode ? (
          <p className="text-gray-700">Calibration Setup</p>
        ) : !testComplete && (
          <p className="text-gray-700">
            Current Visual Acuity Level: {refinementMode ? refinementPairs[currentRefinementIndex] : ACUITY_LEVELS[currentAcuityIndex]}
            {refinementMode && " (Refinement mode)"}
          </p>
        )}
      </div>
      
      {/* Canvas for drawing Landolt C symbols */}
      <canvas 
        ref={canvasRef} 
        width={800} 
        height={400} 
        className="bg-white border border-gray-300 mb-6"
      />
      
      {setupMode ? (
        <div className="flex flex-col items-center w-full max-w-lg px-4">
          <p className="text-lg mb-2">Step 1: Select a reference object:</p>
          <div className="flex flex-wrap justify-center gap-2 mb-4">
            {Object.keys(referenceObjects).map(key => (
              <button
                key={key}
                onClick={() => setReferenceObject(key)}
                className={`px-4 py-2 rounded ${
                  referenceObject === key ? 'bg-blue-500 text-white' : 'bg-gray-200'
                }`}
              >
                {referenceObjects[key].name}
              </button>
            ))}
          </div>
          
          {referenceObject === 'custom' && (
            <div className="mb-4 w-full">
              <p className="text-sm mb-1">Custom object width (mm):</p>
              <input
                type="number"
                value={referenceLength}
                onChange={(e) => setReferenceLength(parseInt(e.target.value) || 100)}
                className="w-full p-2 border rounded"
                min="10"
                max="1000"
              />
            </div>
          )}
          
          <p className="text-lg mb-2">Step 2: Adjust the reference size:</p>
          <input
            type="range"
            min="50"
            max="500"
            value={pixelsPerMm ? pixelsPerMm * (referenceObject === 'custom' ? referenceLength : referenceObjects[referenceObject].width) : 300}
            onChange={(e) => handleCalibrationChange(parseInt(e.target.value))}
            className="w-full mb-4"
          />
          
          <p className="text-lg mb-2">Step 3: Enter your viewing distance:</p>
          <div className="flex items-center mb-6 w-full">
            <input
              type="number"
              value={viewingDistance}
              onChange={(e) => setViewingDistance(parseInt(e.target.value) || 400)}
              className="w-full p-2 border rounded mr-2"
              min="30"
              max="1000"
            />
            <span>cm</span>
          </div>
          
          <button
            onClick={handleCompleteSetup}
            disabled={!pixelsPerMm}
            className={`bg-blue-500 hover:bg-blue-600 text-white px-10 py-3 rounded-lg text-lg ${
              !pixelsPerMm && 'opacity-50 cursor-not-allowed'
            }`}
          >
            Start Test
          </button>
          
          <p className="text-sm text-gray-600 mt-4 text-center">
            Position your reference object against the screen and adjust the size until it matches exactly.
            Then sit at the specified viewing distance for accurate results.
          </p>
        </div>
      ) : !testComplete ? (
        <>
          <p className="text-lg mb-4">Can you clearly see the orientation of all gaps?</p>
          <div className="flex space-x-4">
            <button 
              onClick={() => handleResponse(true)}
              className="bg-green-500 hover:bg-green-600 text-white px-10 py-3 rounded-lg text-lg"
            >
              Yes, I can see them
            </button>
            <button 
              onClick={() => handleResponse(false)}
              className="bg-red-500 hover:bg-red-600 text-white px-10 py-3 rounded-lg text-lg"
            >
              No, they're unclear
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center">
          <p className="text-xl font-bold mb-4">Test complete! Your visual acuity is approximately: {finalAcuity}</p>
          <p className="text-sm text-gray-600 mb-4">
            {finalAcuity === '6/6' ? 
              'This is normal vision.' : 
              (acuityToNumber(finalAcuity) < 6 ? 
                'This is better than normal vision.' : 
                'This is below normal vision.')}
          </p>
          <p className="text-xs text-gray-500 mb-4">
            Note: This is a simplified test and not a substitute for professional eye examination.
          </p>
          <div className="flex space-x-4">
            <button 
              onClick={handleRestart}
              className="bg-blue-500 hover:bg-blue-600 text-white px-10 py-3 rounded-lg text-lg mt-4"
            >
              Restart Test
            </button>
            <button 
              onClick={() => setSetupMode(true)}
              className="bg-gray-500 hover:bg-gray-600 text-white px-10 py-3 rounded-lg text-lg mt-4"
            >
              Recalibrate
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LandoltC;