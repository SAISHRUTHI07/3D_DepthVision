import numpy as np
import cv2

def calculate_slope(elevation_map: np.ndarray, pixel_size: float = 1.0) -> np.ndarray:
    """
    Calculate the local slope in degrees from an elevation grid.
    Uses central differences (gradients) in x and y directions.
    """
    # dy represents row change (vertical), dx represents col change (horizontal)
    dy, dx = np.gradient(elevation_map, pixel_size)
    
    # Calculate rise over run magnitude
    gradient_magnitude = np.sqrt(dx**2 + dy**2)
    
    # Slope in radians: arctan(rise/run)
    slope_radians = np.arctan(gradient_magnitude)
    
    # Convert to degrees
    slope_degrees = np.degrees(slope_radians)
    
    return slope_degrees.astype(np.float32)

def calculate_confidence(depth_map: np.ndarray) -> np.ndarray:
    """
    Calculate a confidence indicator (0.0 to 1.0) for the monocular depth output.
    Confidence is lower in high-frequency edge regions (depth discontinuities)
    where monocular depth maps tend to suffer from boundary bleeding/fuzziness.
    """
    # Calculate depth gradients
    dy, dx = np.gradient(depth_map)
    gradient_magnitude = np.sqrt(dx**2 + dy**2)
    
    # Normalize gradient magnitude to 0-1
    g_min = gradient_magnitude.min()
    g_max = gradient_magnitude.max()
    g_range = g_max - g_min
    
    if g_range > 0:
        normalized_gradients = (gradient_magnitude - g_min) / g_range
    else:
        normalized_gradients = np.zeros_like(gradient_magnitude)
        
    # Invert: higher gradients mean lower confidence
    confidence = 1.0 - normalized_gradients
    
    # Smooth confidence using an OpenCV box filter to avoid sudden pixel-level spikes
    smoothed_confidence = cv2.blur(confidence.astype(np.float32), (5, 5))
    
    # Keep strictly in [0.0, 1.0] range
    return np.clip(smoothed_confidence, 0.0, 1.0)

def downsample_grid(grid: np.ndarray, target_size: int) -> np.ndarray:
    """
    Downsample a 2D grid to a square matrix of size (target_size x target_size).
    Uses INTER_AREA interpolation, which is ideal for decimation/downsampling.
    """
    return cv2.resize(grid, (target_size, target_size), interpolation=cv2.INTER_AREA)


def smooth_terrain_grid(elevation_map: np.ndarray) -> np.ndarray:
    """Remove isolated monocular-depth artifacts without erasing terrain relief.

    A small median pass removes one-pixel spikes/holes. A bilateral pass then
    smooths within regions while keeping real elevation boundaries. The final
    low-weight Gaussian blend makes adjacent mesh vertices transition smoothly
    after downsampling, rather than creating the cloth-like look caused by
    noisy relative-depth predictions.
    """
    terrain = np.asarray(elevation_map, dtype=np.float32)
    if terrain.ndim != 2 or terrain.size == 0:
        raise ValueError("Terrain elevation must be a non-empty 2D array")
    if float(np.ptp(terrain)) < 1e-6:
        return terrain.copy()
    median = cv2.medianBlur(terrain, 3)
    bilateral = cv2.bilateralFilter(median, 7, 12, 5)
    soft = cv2.GaussianBlur(bilateral, (0, 0), 0.85)
    return (bilateral * .78 + soft * .22).astype(np.float32)
