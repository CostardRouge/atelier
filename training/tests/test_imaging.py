import numpy as np

from atelier_training.imaging import fit_long_edge, image_size, load_image, resize_to, save_image


def test_16_bit_tiff_round_trip_keeps_precision(tmp_path):
    img = np.linspace(0, 1, 40 * 30 * 3, dtype=np.float32).reshape(30, 40, 3)
    save_image(img, tmp_path / "a.tif")
    back = load_image(tmp_path / "a.tif")
    assert back.shape == (30, 40, 3)
    assert np.abs(back - img).max() < 1 / 65535 + 1e-7
    assert image_size(tmp_path / "a.tif") == (40, 30)


def test_png_is_read_as_float_rgb(tmp_path):
    img = np.full((10, 20, 3), 0.5, dtype=np.float32)
    save_image(img, tmp_path / "a.png")
    back = load_image(tmp_path / "a.png")
    assert back.dtype == np.float32 and back.shape == (10, 20, 3)
    assert image_size(tmp_path / "a.png") == (20, 10)


def test_fit_long_edge_never_upscales():
    assert fit_long_edge(4000, 3000, 512) == (512, 384)
    assert fit_long_edge(300, 200, 512) == (300, 200)


def test_resize_keeps_a_flat_colour():
    img = np.full((30, 40, 3), 0.25, dtype=np.float32)
    out = resize_to(img, 20, 15)
    assert out.shape == (15, 20, 3)
    assert np.abs(out - 0.25).max() < 1e-4
