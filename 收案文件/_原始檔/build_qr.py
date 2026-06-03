"""Generate a styled QR code PNG for the prototype URL."""

import qrcode
from qrcode.image.styledpil import StyledPilImage
from qrcode.image.styles.moduledrawers import RoundedModuleDrawer
from PIL import Image

URL = "https://prototype-zeta-black.vercel.app/"
OUT = "/Users/huangshifeng/Desktop/Research/AI_Clinical/痔瘡AI衛教/收案文件/_原始檔/qr_code.png"

qr = qrcode.QRCode(
    version=None,
    error_correction=qrcode.constants.ERROR_CORRECT_H,  # high EC for logo overlay
    box_size=20,
    border=2,
)
qr.add_data(URL)
qr.make(fit=True)

img = qr.make_image(
    image_factory=StyledPilImage,
    module_drawer=RoundedModuleDrawer(),
    fill_color="#0f4c75",
    back_color="#ffffff",
)

# Convert to RGBA for compositing
img = img.convert("RGBA")

# Try to overlay hospital logo in center
import os
logo_path = "/Users/huangshifeng/Desktop/Research/AI_Clinical/痔瘡AI衛教/prototype/public/KSVGH.png"
if os.path.exists(logo_path):
    logo = Image.open(logo_path).convert("RGBA")
    # Logo size = ~22% of QR for readability with HIGH error correction
    logo_max = int(img.size[0] * 0.22)
    logo.thumbnail((logo_max, logo_max), Image.LANCZOS)

    # White rounded background behind logo
    bg_pad = 10
    bg_size = (logo.size[0] + bg_pad * 2, logo.size[1] + bg_pad * 2)
    bg = Image.new("RGBA", bg_size, (255, 255, 255, 255))

    # Paste bg then logo centered
    pos_bg = ((img.size[0] - bg_size[0]) // 2, (img.size[1] - bg_size[1]) // 2)
    img.paste(bg, pos_bg)
    pos_logo = ((img.size[0] - logo.size[0]) // 2, (img.size[1] - logo.size[1]) // 2)
    img.paste(logo, pos_logo, logo)

img.save(OUT, "PNG")
print(f"QR code saved → {OUT} ({img.size[0]}x{img.size[1]})")
