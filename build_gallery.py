import os
from pathlib import Path

# Configuration
site_title = "Insect Macro Photography"
site_description = "A collection of macro insect photographs"

# Get all image files
images = []
for ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']:
    for file in Path('.').rglob(f'*{ext}'):
        if str(file.parent) != '.':
            images.append({
                'filename': str(file),
                'album': str(file.parent.name),
                'name': file.stem
            })

# Generate HTML
html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{site_title}</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #111; color: #fff; padding: 20px; }}
        h1 {{ text-align: center; padding: 40px 0 10px; font-weight: 300; letter-spacing: 2px; }}
        .subtitle {{ text-align: center; color: #888; margin-bottom: 40px; }}
        .album {{ margin-bottom: 60px; }}
        .album h2 {{ color: #eee; font-weight: 300; padding-bottom: 10px; border-bottom: 1px solid #333; margin-bottom: 20px; }}
        .gallery {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 15px; }}
        .gallery img {{ width: 100%; height: 250px; object-fit: cover; border-radius: 8px; transition: transform 0.3s; cursor: pointer; }}
        .gallery img:hover {{ transform: scale(1.03); }}
        .footer {{ text-align: center; color: #555; padding: 40px 0 20px; font-size: 14px; }}
    </style>
</head>
<body>
    <h1>{site_title}</h1>
    <p class="subtitle">{site_description}</p>
"""

# Group images by album
albums = {}
for img in images:
    album = img['album']
    if album not in albums:
        albums[album] = []
    albums[album].append(img)

for album, photos in albums.items():
    html += f'<div class="album"><h2>{album}</h2><div class="gallery">'
    for photo in photos:
        html += f'<img src="{photo["filename"]}" alt="{photo["name"]}" loading="lazy">'
    html += '</div></div>'

html += """
    <div class="footer">© 2026 • All rights reserved</div>
</body>
</html>
"""

with open('index.html', 'w') as f:
    f.write(html)

print(f"Generated index.html with {len(images)} images in {len(albums)} albums")
