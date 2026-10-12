"""Create a mask from explicitly selected rectangles; never alter the original."""
import json
import sys
from PIL import Image, ImageDraw, ImageOps

Image.MAX_IMAGE_PIXELS = 16_000_000
with Image.open(sys.argv[1]) as original:
    if original.width * original.height > 16_000_000:
        raise ValueError('Bildfläche überschreitet 16 Megapixel')
    image = ImageOps.exif_transpose(original)
    width, height = image.size
rectangles = json.loads(sys.argv[2])
if not 1 <= len(rectangles) <= 50:
    raise ValueError('Mindestens ein Bereich erforderlich')
mask = Image.new('L', (width, height), 0)
draw = ImageDraw.Draw(mask)
for rect in rectangles:
    left, top = int(rect['x'] * width), int(rect['y'] * height)
    right = min(width - 1, max(left, int((rect['x'] + rect['width']) * width) - 1))
    bottom = min(height - 1, max(top, int((rect['y'] + rect['height']) * height) - 1))
    draw.rectangle((left, top, right, bottom), fill=255)
mask.save(sys.stdout.buffer, format='PNG')
