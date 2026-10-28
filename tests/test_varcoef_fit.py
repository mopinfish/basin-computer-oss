"""Fixed-basis, fixed-alpha learning from small explicit numeric arrays."""
from fractions import Fraction

import numpy as np
import pytest
from sklearn.linear_model import Ridge
from basin_rc import varying_coefficient as module


def fit(X, z, y, **kwargs):
    return module.fit_varying_coefficient(X, z, y, **kwargs)


def fixture(M=2, n=16, p=3):
    rng = np.random.default_rng(664)
    X = rng.uniform(-2, 2, (n, p))
    z = rng.uniform(-2, 2, (n, 2))
    y = rng.uniform(-2, 2, (n, 2))
    centers = rng.uniform(-2, 2, (M, 2))
    return X, z, y, dict(centers=centers, width=1.25, alpha=.5)


def direct(X, z, y, centers, width, alpha):
    phi = module.gaussian_partition(z, centers, width)
    T = (phi[:, :, None] * X[:, None, :]).reshape(len(X), -1)
    mean = T.mean(axis=0)
    centered = T - mean
    A = centered.T @ centered + alpha * np.eye(T.shape[1])
    assert np.linalg.cond(A) <= 1e4
    W = np.linalg.solve(A, centered.T @ (y - y.mean(axis=0)))
    return T, mean, W, y.mean(axis=0) - mean @ W


def test_hand_computable_single_basis():
    model = fit(np.array([[-1.], [1.]]), np.zeros((2, 1)),
                np.array([[-2.], [2.]]), centers=np.zeros((1, 1)), width=.5, alpha=2.)
    np.testing.assert_allclose(model._coefficients, [[[1.]]], atol=1e-10, rtol=1e-10)
    np.testing.assert_allclose(model._bias, [0.], atol=1e-10, rtol=1e-10)


@pytest.mark.parametrize('M', [1, 2, 3])
def test_centered_tensor_formula_and_single_prediction(M):
    X, z, y, options = fixture(M)
    T, mean, W, bias = direct(X, z, y, **options)
    model = fit(X, z, y, **options)
    assert isinstance(model, module.VaryingCoefficientReadout)
    np.testing.assert_allclose(model._coefficients.reshape(W.shape), W, atol=1e-10, rtol=1e-10)
    np.testing.assert_allclose(model._bias, bias, atol=1e-10, rtol=1e-10)
    np.testing.assert_allclose(model.predict(X, z), T @ W + bias, atol=1e-10, rtol=1e-10)
    for i in range(len(X)):
        np.testing.assert_allclose(model.predict_one(X[i], z[i]), model.predict(X, z)[i], atol=1e-12, rtol=1e-12)
    if M > 1:
        phi = module.gaussian_partition(z, options['centers'], options['width'])
        assert not np.allclose(mean, np.outer(phi.mean(axis=0), X.mean(axis=0)).reshape(-1))


def test_single_basis_matches_ridge():
    X, z, y, options = fixture(1)
    model = fit(X, z, y, **options)
    reference = Ridge(alpha=options['alpha'], fit_intercept=True).fit(X, y)
    np.testing.assert_allclose(model._coefficients[0], reference.coef_.T, atol=1e-10, rtol=1e-10)
    np.testing.assert_allclose(model._bias, reference.intercept_, atol=1e-10, rtol=1e-10)


@pytest.mark.parametrize('n', [1, 16])
def test_constant_expanded_features(n):
    X = np.full((n, 3), 2.)
    z = np.zeros((n, 2))
    y = np.arange(n * 2, dtype=float).reshape(n, 2) / 16
    model = fit(X, z, y, centers=np.zeros((2, 2)), width=.5, alpha=2.)
    np.testing.assert_allclose(model._coefficients, 0, atol=1e-10, rtol=0)
    np.testing.assert_allclose(model._bias, y.mean(axis=0), atol=1e-10, rtol=1e-10)


def test_constant_raw_features_with_variable_basis_can_learn():
    X, z, _, options = fixture()
    X[:] = 1
    y = module.gaussian_partition(z, options['centers'], options['width'])[:, :1]
    model = fit(X, z, y, **options)
    assert np.max(np.abs(model._coefficients)) > .01


def test_target_shift_copies_and_no_input_mutation():
    X, z, y, options = fixture()
    before = [a.copy() for a in (X, z, y, options['centers'])]
    first = fit(X, z, y, **options)
    shifted = fit(X, z, y + 2, **options)
    np.testing.assert_allclose(shifted._coefficients, first._coefficients, atol=1e-10, rtol=1e-10)
    np.testing.assert_allclose(shifted._bias, first._bias + 2, atol=1e-10, rtol=1e-10)
    saved = first.predict(X, z)
    for a, original in zip((X, z, y, options['centers']), before):
        np.testing.assert_array_equal(a, original)
        a[:] = 0
    np.testing.assert_allclose(first.predict(before[0], before[1]), saved, atol=1e-12, rtol=1e-12)
    assert not first._coefficients.flags.writeable
    assert not first._bias.flags.writeable


def test_duplicate_centers_and_more_features_than_rows():
    X, z, y, options = fixture(M=3, n=2, p=4)
    options['centers'][:] = 0
    model = fit(X, z, y, **options)
    _, _, W, bias = direct(X, z, y, **options)
    np.testing.assert_allclose(model._coefficients.reshape(W.shape), W, atol=1e-10, rtol=1e-10)
    np.testing.assert_allclose(model._bias, bias, atol=1e-10, rtol=1e-10)


@pytest.mark.parametrize('alpha', [0., -1., np.inf, np.nan, True, np.bool_(True), '1', None,
                                  np.array(1.), 10**400, Fraction(1, 10**400)])
def test_reject_invalid_alpha(alpha):
    X, z, y, options = fixture()
    options['alpha'] = alpha
    with pytest.raises(ValueError):
        fit(X, z, y, **options)


@pytest.mark.parametrize('name', ['X', 'z', 'y', 'centers'])
@pytest.mark.parametrize('bad', [[], np.ones((2, 2), dtype=bool), np.ones((2, 2), dtype=complex),
                                 np.ones((2, 2), dtype=object), np.ma.array(np.ones((2, 2))),
                                 np.full((2, 2), np.inf), np.full((2, 2), np.nan), np.ones(2)])
def test_reject_invalid_array(name, bad):
    X, z, y, options = fixture()
    args = dict(X=X, z=z, y=y, **options)
    args[name] = bad
    with pytest.raises(ValueError):
        fit(**args)


@pytest.mark.parametrize('name,shape', [('X', (0, 3)), ('X', (16, 0)), ('z', (16, 0)),
                                       ('z', (15, 2)), ('y', (16, 0)), ('y', (15, 2)),
                                       ('centers', (0, 2)), ('centers', (2, 0)), ('centers', (2, 3))])
def test_reject_invalid_dimensions(name, shape):
    X, z, y, options = fixture()
    args = dict(X=X, z=z, y=y, **options)
    args[name] = np.zeros(shape)
    with pytest.raises(ValueError):
        fit(**args)


@pytest.mark.parametrize('width', [0., -1., True, np.nan, np.inf, 1e-200, 1e200])
def test_reject_invalid_width(width):
    X, z, y, options = fixture()
    options['width'] = width
    with pytest.raises(ValueError):
        fit(X, z, y, **options)


def test_memory_limits_before_basis_allocation(monkeypatch):
    X, z, y, options = fixture()
    limit = 8 * len(X) * len(options['centers']) * X.shape[1]
    monkeypatch.setattr(module, '_FIT_MATRIX_BYTES', limit)
    fit(X, z, y, **options)  # Exact boundary is allowed, without large allocations.
    monkeypatch.setattr(module, '_FIT_MATRIX_BYTES', limit - 1)
    monkeypatch.setattr(module, 'gaussian_partition', lambda *a: pytest.fail('Allocated basis before memory refusal'))
    with pytest.raises(ValueError, match='64 MiB'):
        fit(X, z, y, **options)


def test_gram_memory_limit(monkeypatch):
    X, z, y, options = fixture(M=3, n=1, p=4)
    monkeypatch.setattr(module, '_FIT_MATRIX_BYTES', 8 * 12**2 - 1)
    with pytest.raises(ValueError, match='64 MiB'):
        fit(X, z, y, **options)


def test_solver_error_preserves_cause(monkeypatch):
    X, z, y, options = fixture()
    def fail(*args):
        raise np.linalg.LinAlgError('singular')
    monkeypatch.setattr(np.linalg, 'solve', fail)
    with pytest.raises(ValueError) as caught:
        fit(X, z, y, **options)
    assert isinstance(caught.value.__cause__, np.linalg.LinAlgError)


@pytest.mark.parametrize('field', ['X', 'y'])
def test_reject_nonfinite_intermediate(field):
    X, z, y, options = fixture(1)
    args = dict(X=X, z=z, y=y, **options)
    args[field][:] = 1e308
    with pytest.raises(ValueError):
        fit(**args)


def test_positive_alpha_can_still_fail_without_fallback():
    X = np.array([[-1., -1.], [1., 1.]])
    with pytest.raises(ValueError):
        fit(X, np.zeros((2, 1)), np.array([[-1.], [1.]]),
            centers=np.zeros((1, 1)), width=1., alpha=1e-300)


def test_integer_inputs_are_accepted():
    model = fit(np.array([[-1], [1]]), np.zeros((2, 1), dtype=int),
                np.array([[-2], [2]]), centers=np.zeros((1, 1), dtype=int), width=1, alpha=2)
    np.testing.assert_allclose(model._coefficients, [[[1.]]], atol=1e-10, rtol=1e-10)
    assert module._FIT_MATRIX_BYTES == 64 << 20


def test_nonfinite_solver_output_is_rejected(monkeypatch):
    X, z, y, options = fixture()
    monkeypatch.setattr(np.linalg, 'solve', lambda A, B: np.full_like(B, np.inf))
    with pytest.raises(ValueError):
        fit(X, z, y, **options)
