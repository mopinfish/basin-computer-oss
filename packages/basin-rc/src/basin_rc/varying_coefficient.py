"""Explicit Gaussian bases, fixed-alpha learning and numeric inference.

Inputs are numeric arrays, without automatic scaling, time alignment,
selection, or physical-unit conversion.
"""
from numbers import Real

import numpy as np

__all__ = ['gaussian_partition', 'VaryingCoefficientReadout', 'fit_varying_coefficient']

_FIT_MATRIX_BYTES = 64 << 20


def _array(value: np.ndarray, ndim: int, name: str) -> np.ndarray:
    if (type(value) is not np.ndarray or value.ndim != ndim
            or value.dtype.kind not in 'iuf'):
        raise ValueError(f'{name} requires a {ndim}-dimensional plain real numeric ndarray')
    try:
        with np.errstate(over='raise', invalid='raise'):
            result = value.astype(np.float64, copy=True)
    except (ValueError, FloatingPointError, OverflowError) as error:
        raise ValueError(f'{name} cannot be represented as float64') from error
    if not np.isfinite(result).all():
        raise ValueError(f'{name} must contain finite values')
    return result


def _width(value: float) -> tuple[float, float]:
    if not isinstance(value, Real) or isinstance(value, (bool, np.bool_)):
        raise ValueError('width must be a finite positive real scalar')
    try:
        width = float(value)
    except (ValueError, OverflowError) as error:
        raise ValueError('width cannot be represented as float64') from error
    with np.errstate(over='ignore', under='ignore', invalid='ignore'):
        denominator = float(2. * np.float64(width) * np.float64(width))
    if (not np.isfinite(width) or width <= 0.
            or not np.isfinite(denominator) or denominator <= 0.):
        raise ValueError('width and its Gaussian denominator must be finite and positive')
    return width, denominator


def _finite(result: np.ndarray) -> np.ndarray:
    if not np.isfinite(result).all():
        raise ValueError('Calculation cannot be represented as finite float64 values')
    return result


def gaussian_partition(z: np.ndarray, centers: np.ndarray, width: float) -> np.ndarray:
    """Return normalized bases (n,M) for coordinates (n,d) and centers (M,d)."""
    z = _array(z, 2, 'z')
    centers = _array(centers, 2, 'centers')
    _, denominator = _width(width)
    if centers.shape[0] == 0 or centers.shape[1] == 0 or z.shape[1] != centers.shape[1]:
        raise ValueError('centers require positive dimensions and the same coordinate dimension as z')
    if z.shape[0] == 0:
        return np.empty((0, centers.shape[0]), dtype=np.float64)
    try:
        with np.errstate(over='raise', invalid='raise', divide='raise', under='ignore'):
            difference = _finite(z[:, None, :] - centers[None, :, :])
            distances = _finite(np.sum(difference ** 2, axis=2))
            logw = _finite(-distances / denominator)
            logw = _finite(logw - logw.max(axis=1, keepdims=True))
            weights = np.exp(logw)
            return _finite(weights / weights.sum(axis=1, keepdims=True))
    except FloatingPointError as error:
        raise ValueError('Gaussian calculation cannot be represented as finite float64 values') from error


class VaryingCoefficientReadout:
    """Inference with centers (M,d), coefficients (M,p,H), and bias (H,).

    Construction copies supplied arrays. No fit, state generation, or saved-model
    format is provided. Feature and coordinate column order belongs to the caller.
"""

    def __init__(self, *, centers: np.ndarray, width: float,
                 coefficients: np.ndarray, bias: np.ndarray) -> None:
        centers = _array(centers, 2, 'centers')
        coefficients = _array(coefficients, 3, 'coefficients')
        bias = _array(bias, 1, 'bias')
        width, _ = _width(width)
        if (min(centers.shape) == 0 or min(coefficients.shape) == 0
                or coefficients.shape[0] != centers.shape[0]
                or bias.shape[0] != coefficients.shape[2]):
            raise ValueError('Model dimensions M,d,p,H must be positive and consistent')
        for array in (centers, coefficients, bias):
            array.setflags(write=False)
        self._centers = centers
        self._width = width
        self._coefficients = coefficients
        self._bias = bias

    def predict(self, X: np.ndarray, z: np.ndarray) -> np.ndarray:
        """Return (n,H) predictions from explicit features (n,p) and states (n,d)."""
        X = _array(X, 2, 'X')
        z = _array(z, 2, 'z')
        if (X.shape[1] != self._coefficients.shape[1]
                or z.shape[1] != self._centers.shape[1] or X.shape[0] != z.shape[0]):
            raise ValueError('Prediction feature, coordinate, and row dimensions must match the model')
        phi = gaussian_partition(z, self._centers, self._width)
        result = np.zeros((len(X), len(self._bias)), dtype=np.float64)
        try:
            with np.errstate(over='raise', invalid='raise', divide='raise', under='ignore'):
                for m in range(len(self._centers)):
                    local = _finite(X @ self._coefficients[m])
                    result += phi[:, m, None] * local
                    _finite(result)
                result += self._bias
                return _finite(result)
        except FloatingPointError as error:
            raise ValueError('Prediction cannot be represented as finite float64 values') from error

    def predict_one(self, x: np.ndarray, z: np.ndarray) -> np.ndarray:
        """Return (H,) predictions for one feature vector (p,) and state (d,)."""
        x = _array(x, 1, 'x')
        z = _array(z, 1, 'z')
        M, p, H = self._coefficients.shape
        if x.shape != (p,) or z.shape != (self._centers.shape[1],):
            raise ValueError('Single prediction dimensions must match the model')
        phi = gaussian_partition(z[None, :], self._centers, self._width)[0]
        try:
            with np.errstate(over='raise', invalid='raise', divide='raise', under='ignore'):
                coefficients = _finite(phi @ self._coefficients.reshape(M, p * H)).reshape(p, H)
                return _finite(x @ coefficients + self._bias)
        except FloatingPointError as error:
            raise ValueError('Prediction cannot be represented as finite float64 values') from error


def fit_varying_coefficient(
    X: np.ndarray, z: np.ndarray, y: np.ndarray, *,
    centers: np.ndarray, width: float, alpha: float,
) -> VaryingCoefficientReadout:
    """Fit centered tensor ridge with fixed bases, positive alpha and a free bias.

    X (n,p), z (n,d), y (n,H) and centers (M,d) must have positive dimensions.
    Tensor expansion and Gram matrices are each limited to 64 MiB; this is not
    a bound on total process memory. No scaling, selection or fallback is done.
    """
    X = _array(X, 2, 'X')
    z = _array(z, 2, 'z')
    y = _array(y, 2, 'y')
    centers = _array(centers, 2, 'centers')
    n, p = X.shape
    M, d = centers.shape
    if (min(n, p, M, d, y.shape[1]) == 0 or z.shape != (n, d)
            or y.shape[0] != n):
        raise ValueError('Learning dimensions n,p,d,M,H must be positive and consistent')
    if not isinstance(alpha, Real) or isinstance(alpha, (bool, np.bool_)):
        raise ValueError('alpha must be a finite positive real scalar')
    try:
        alpha = float(alpha)
    except (ValueError, OverflowError) as error:
        raise ValueError('alpha cannot be represented as float64') from error
    if not np.isfinite(alpha) or alpha <= 0.:
        raise ValueError('alpha must be finite and positive in float64')
    tensor_features = M * p
    if (8 * n * tensor_features > _FIT_MATRIX_BYTES
            or 8 * tensor_features ** 2 > _FIT_MATRIX_BYTES):
        raise ValueError('Tensor expansion and Gram must each be at most 64 MiB')
    phi = gaussian_partition(z, centers, width)
    try:
        with np.errstate(over='raise', invalid='raise', divide='raise', under='ignore'):
            tensor = _finite((phi[:, :, None] * X[:, None, :]).reshape(n, tensor_features))
            mean_tensor = _finite(tensor.mean(axis=0))
            mean_y = _finite(y.mean(axis=0))
            centered_tensor = _finite(tensor - mean_tensor)
            centered_y = _finite(y - mean_y)
            gram = _finite(centered_tensor.T @ centered_tensor)
            gram.flat[::tensor_features + 1] += alpha
            _finite(gram)
            rhs = _finite(centered_tensor.T @ centered_y)
            W = _finite(np.linalg.solve(gram, rhs))
            bias = _finite(mean_y - mean_tensor @ W)
    except (FloatingPointError, np.linalg.LinAlgError) as error:
        raise ValueError('Learning calculation cannot be represented or solved in float64') from error
    return VaryingCoefficientReadout(centers=centers, width=width,
                                    coefficients=W.reshape(M, p, y.shape[1]), bias=bias)
