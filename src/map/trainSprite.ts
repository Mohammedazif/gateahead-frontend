/** Nose points up, so a map bearing of 0 keeps the locomotive aimed north. */
export function trainImage(): { width: number; height: number; data: Uint8ClampedArray } {
  const width = 64;
  const height = 240;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d");
  if (!g) return { width: 1, height: 1, data: new Uint8ClampedArray(4) };

  const body = (x: number, y: number, w: number, h: number, fill: string) => {
    g.fillStyle = fill;
    g.fillRect(x, y, w, h);
  };

  body(16, 148, 32, 78, "#6e2430");
  body(16, 66, 32, 76, "#6e2430");
  body(18, 70, 28, 8, "#d7d0c4");
  body(18, 152, 28, 8, "#d7d0c4");
  for (const y of [86, 108, 168, 190]) {
    body(14, y, 4, 16, "#d5ecff");
    body(46, y, 4, 16, "#d5ecff");
  }

  body(15, 14, 34, 48, "#2a6cb5");
  body(18, 34, 28, 6, "#f0c14a");
  g.fillStyle = "#e8eef6";
  g.beginPath();
  g.ellipse(32, 16, 10, 6, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#fff4cc";
  g.beginPath();
  g.arc(24, 12, 2.4, 0, Math.PI * 2);
  g.arc(40, 12, 2.4, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#d5dae0";
  g.lineWidth = 1.5;
  g.strokeRect(27, 22, 10, 7);
  g.beginPath();
  g.moveTo(24, 24);
  g.lineTo(40, 24);
  g.moveTo(32, 22);
  g.lineTo(32, 29);
  g.stroke();

  const image = g.getImageData(0, 0, width, height);
  return { width, height, data: image.data };
}
