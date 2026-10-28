"""Small independent numerical checks for explicit, inference-only readouts."""
import numpy as np
import pytest
from sklearn.linear_model import Ridge

from basin_rc.varying_coefficient import gaussian_partition, VaryingCoefficientReadout


def model_inputs():
    return dict(centers=np.array([[-1., 0.], [1., 0.]]), width=1.25,
                coefficients=np.array([[[1., 2.], [3., -1.]],
                                       [[-2., 1.], [0.5, 4.]]]),
                bias=np.array([0.25, -0.5]))


def test_public_names_and_hand_computed_basis():
    import basin_rc
    import basin_rc.varying_coefficient as module
    assert len(basin_rc.__all__) == 12
    assert set(module.__all__) == {'gaussian_partition', 'VaryingCoefficientReadout', 'fit_varying_coefficient'}
    z = np.array([[0.], [1.]])
    centers = np.array([[0.], [2.]])
    expected = np.array([[1. / (1. + np.exp(-2.)), np.exp(-2.) / (1. + np.exp(-2.))],
                         [0.5, 0.5]])
    actual = gaussian_partition(z, centers, 1.)
    np.testing.assert_allclose(actual, expected, atol=1e-12, rtol=1e-12)
    np.testing.assert_allclose(actual.sum(axis=1), 1., atol=1e-15, rtol=0)


def test_duplicate_centers_single_basis_and_empty_batch():
    z = np.array([[3., -2.], [0., 1.]])
    np.testing.assert_array_equal(gaussian_partition(z, np.zeros((1, 2)), .5), np.ones((2, 1)))
    np.testing.assert_array_equal(gaussian_partition(z, np.zeros((2, 2)), .5), np.full((2, 2), .5))
    assert gaussian_partition(np.empty((0, 2)), np.zeros((3, 2)), .5).shape == (0, 3)
    model = VaryingCoefficientReadout(**model_inputs())
    assert model.predict(np.empty((0, 2)), np.empty((0, 2))).shape == (0, 2)


def test_tensor_direct_expression_and_centered_research_mapping():
    params = model_inputs()
    X = np.array([[1., -2.], [-1., 0.5], [2., 1.]])
    z = np.array([[0., 1.], [-2., 0.], [1., -1.]])
    distances = ((z[:, None, :] - params['centers'][None, :, :]) ** 2).sum(axis=2)
    weights = np.exp(-distances / (2. * params['width'] ** 2))
    weights /= weights.sum(axis=1, keepdims=True)
    tensor = np.stack([np.kron(weights[i], X[i]) for i in range(len(X))])
    W = params['coefficients'].reshape(4, 2)
    mean_x = np.array([0.3, -0.4, 0.1, 0.2])  # Expanded features, not raw X mean.
    mean_y = np.array([1.2, -2.1])
    params['bias'] = mean_y - mean_x @ W
    expected = (tensor - mean_x) @ W + mean_y
    model = VaryingCoefficientReadout(**params)
    np.testing.assert_allclose(model.predict(X, z), expected, atol=1e-12, rtol=1e-12)
    for i in range(len(X)):
        np.testing.assert_allclose(model.predict_one(X[i], z[i]), expected[i], atol=1e-12, rtol=1e-12)


def test_single_basis_matches_small_fixed_ridge():
    X = np.array([[i / 8., (i % 3) - 1.] for i in range(12)])
    y = np.column_stack([X[:, 0] + X[:, 1] / 2., 2. * X[:, 0] - X[:, 1] + .3])
    fitted = Ridge(alpha=1.).fit(X, y)
    model = VaryingCoefficientReadout(centers=np.zeros((1, 1)), width=.5,
                                     coefficients=fitted.coef_.T[None], bias=fitted.intercept_)
    np.testing.assert_allclose(model.predict(X, np.zeros((12, 1))), fitted.predict(X), atol=1e-12, rtol=1e-12)


def test_constructor_copies_and_predictions_preserve_inputs():
    params = model_inputs()
    model = VaryingCoefficientReadout(**params)
    X, z = np.array([[2, 1]], dtype=np.int64), np.array([[0, 1]], dtype=np.int64)
    expected = model.predict(X, z)
    for key in ('centers', 'coefficients', 'bias'):
        params[key].fill(99)
    actual = model.predict(X, z)
    np.testing.assert_array_equal(actual, expected)
    np.testing.assert_array_equal(X, [[2, 1]])
    np.testing.assert_array_equal(z, [[0, 1]])
    actual.fill(99)
    np.testing.assert_array_equal(model.predict(X, z), expected)
    for value in vars(model).values():
        if isinstance(value, np.ndarray):
            assert not value.flags.writeable


@pytest.mark.parametrize('width', [True, False, np.bool_(True), '1', None, 0., -1., np.nan, np.inf, 1e-200, 1e200, np.array(1.)])
def test_invalid_width_rejected(width):
    with pytest.raises(ValueError):
        gaussian_partition(np.zeros((1, 1)), np.zeros((1, 1)), width)
    params = model_inputs(); params['width'] = width
    with pytest.raises(ValueError):
        VaryingCoefficientReadout(**params)


@pytest.mark.parametrize('bad', [[[0.]], np.array([[True]]), np.array([[1j]]),
                               np.array([['0']]), np.array([[0.]], dtype=object),
                               np.array([[np.nan]]), np.array([[np.inf]]),
                               np.array([0.]), np.array(0.), np.empty((1, 0))])
@pytest.mark.parametrize('argument', ['z', 'centers'])
def test_invalid_basis_arrays_rejected(bad, argument):
    params = dict(z=np.zeros((1, 1)), centers=np.zeros((1, 1)), width=1.)
    params[argument] = bad
    with pytest.raises(ValueError):
        gaussian_partition(**params)


def test_basis_shape_mismatch_and_empty_centers_rejected():
    for centers in (np.zeros((1, 2)), np.empty((0, 1))):
        with pytest.raises(ValueError):
            gaussian_partition(np.zeros((1, 1)), centers, 1.)


@pytest.mark.parametrize('argument,bad', [
    ('coefficients', [[[1.]]]), ('coefficients', np.ones((2, 2))),
    ('coefficients', np.ones((1, 2, 2))), ('coefficients', np.empty((2, 0, 2))),
    ('coefficients', np.empty((2, 2, 0))), ('coefficients', np.full((2, 2, 2), np.nan)),
    ('coefficients', np.ones((2, 2, 2), dtype=bool)),
    ('bias', [0., 0.]), ('bias', np.ones((2, 1))), ('bias', np.ones(1)),
    ('bias', np.array([0., np.inf])), ('bias', np.array([1j, 0.])),
    ('centers', np.empty((0, 2))), ('centers', np.array([[np.inf, 0.], [0., 0.]])),
])
def test_invalid_model_arrays_rejected(argument, bad):
    params = model_inputs(); params[argument] = bad
    with pytest.raises(ValueError):
        VaryingCoefficientReadout(**params)


@pytest.mark.parametrize('X,z', [
    ([[1., 2.]], np.zeros((1, 2))), (np.ones(2), np.zeros((1, 2))),
    (np.ones((1, 3)), np.zeros((1, 2))), (np.ones((1, 2)), np.zeros((2, 2))),
    (np.ones((1, 2)), np.zeros((1, 3))), (np.ones((1, 2)), np.zeros(2)),
    (np.full((1, 2), np.nan), np.zeros((1, 2))),
    (np.ones((1, 2), dtype=bool), np.zeros((1, 2))),
    (np.ones((1, 2)), np.full((1, 2), np.inf)),
])
def test_invalid_prediction_arrays_rejected(X, z):
    model = VaryingCoefficientReadout(**model_inputs())
    with pytest.raises(ValueError):
        model.predict(X, z)


@pytest.mark.parametrize('x,z', [(np.ones((1, 2)), np.zeros(2)),
                               (np.ones(2), np.zeros((1, 2))),
                               (np.ones(3), np.zeros(2)),
                               (np.ones(2), [0., 0.])])
def test_invalid_single_prediction_arrays_rejected(x, z):
    with pytest.raises(ValueError):
        VaryingCoefficientReadout(**model_inputs()).predict_one(x, z)


def test_finite_far_coordinates_stay_normalized():
    actual = gaussian_partition(np.array([[1e6]]), np.array([[0.], [1.]]), .5)
    assert np.isfinite(actual).all()
    np.testing.assert_allclose(actual.sum(axis=1), 1., atol=1e-15, rtol=0)


def test_unrepresentable_distance_and_prediction_rejected():
    with pytest.raises(ValueError):
        gaussian_partition(np.array([[1e308]]), np.zeros((1, 1)), 1.)
    model = VaryingCoefficientReadout(centers=np.zeros((1, 1)), width=1.,
                                     coefficients=np.full((1, 1, 1), 1e308), bias=np.zeros(1))
    with pytest.raises(ValueError):
        model.predict(np.array([[2.]]), np.zeros((1, 1)))
    with pytest.raises(ValueError):
        model.predict_one(np.array([2.]), np.zeros(1))


@pytest.mark.parametrize('bad', [np.ma.array([[np.nan]], mask=[[True]]),
                               np.ma.array([[0.]], mask=[[True]]),
                               np.asmatrix([[0.]])])
def test_array_subclasses_are_rejected(bad):
    with pytest.raises(ValueError):
        gaussian_partition(bad, np.zeros((1, 1)), 1.)
    with pytest.raises(ValueError):
        VaryingCoefficientReadout(centers=bad, width=1.,
                                 coefficients=np.ones((1, 1, 1)), bias=np.zeros(1))
    model = VaryingCoefficientReadout(centers=np.zeros((1, 1)), width=1.,
                                     coefficients=np.ones((1, 1, 1)), bias=np.zeros(1))
    with pytest.raises(ValueError):
        model.predict(bad, np.zeros((1, 1)))
