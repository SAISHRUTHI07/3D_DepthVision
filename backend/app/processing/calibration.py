import numpy as np
import os

def calibrate_depth_to_elevation(depth_map: np.ndarray, gcp_points: list) -> tuple:
    """
    Fits a linear mapping (Elevation = Depth * Scale + Offset) based on Ground Control Points (GCPs).
    Args:
        depth_map: 2D float32 numpy array of relative depths.
        gcp_points: List of dicts, e.g., [{"x": 120, "y": 340, "elevation": 150.0}, ...]
    Returns:
        (calibrated_map, scale, offset, num_points_used, method_description)
    """
    height, width = depth_map.shape
    valid_depths = []
    valid_elevations = []

    # 1. Match GCP image coordinates (x, y) to depth array indexes [row, col] -> [y, x]
    for pt in gcp_points:
        x, y = int(pt.get("x", -1)), int(pt.get("y", -1))
        target_elev = pt.get("elevation")
        
        # Verify coordinate bounds
        if 0 <= x < width and 0 <= y < height and target_elev is not None:
            depth_val = depth_map[y, x]
            valid_depths.append(depth_val)
            valid_elevations.append(float(target_elev))

    num_points = len(valid_depths)

    # 2. Determine Scale and Offset
    if num_points >= 2:
        # Perform Least Squares Linear Regression
        D = np.array(valid_depths, dtype=np.float32)
        E = np.array(valid_elevations, dtype=np.float32)
        
        # Check if all depth values are identical (to avoid divide by zero in slope)
        if np.allclose(D, D[0]):
            scale = 1.0
            offset = E.mean() - D[0]
            method = "Least squares (Fallback due to identical depths: constant offset)"
        else:
            # np.polyfit(x, y, 1) returns [slope, intercept]
            slope, intercept = np.polyfit(D, E, 1)
            scale = float(slope)
            offset = float(intercept)
            method = f"Least squares regression (using {num_points} GCPs)"
            
    elif num_points == 1:
        # Exact fit for 1 point. Assume default scale of 10.0 (1 unit depth = 10m elevation change)
        scale = 10.0
        offset = valid_elevations[0] - (valid_depths[0] * scale)
        method = "Single point calibration (Default scale 10.0 applied)"
        
    else:
        # 0 points. Relative scale. Preserve min as 0m, scale max to 100m to represent relative heights
        d_min = float(depth_map.min())
        d_max = float(depth_map.max())
        d_range = d_max - d_min
        
        if d_range > 0:
            scale = 100.0 / d_range
            offset = -d_min * scale
        else:
            scale = 1.0
            offset = 0.0
        method = "Default relative scaling (0m to 100m range, approximate)"

    # 3. Apply Calibration
    calibrated_map = depth_map * scale + offset
    
    return calibrated_map, scale, offset, num_points, method
