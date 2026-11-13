// Render the SVG masters directly with Chromium; no npm packages required.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const [executable, jobFile] = process.argv.slice(2);
if (!executable || !jobFile) throw new Error('Usage: node render.mjs CHROMIUM JOBS.json');
const flags = ['--headless', '--disable-gpu', '--remote-debugging-pipe'];
if (process.env.GATEAHEAD_NO_SANDBOX === '1') flags.push('--no-sandbox');
const browser = spawn(executable, flags, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
let buffer = '', nextId = 0, diagnostics = '';
const pending = new Map();
function rejectPending(error) {
  for (const item of pending.values()) {
    clearTimeout(item.timeout);
    item.reject(error);
  }
  pending.clear();
}
browser.stderr.on('data', data => { diagnostics = (diagnostics + data).slice(-2000); });
browser.on('error', rejectPending);
browser.on('exit', code => rejectPending(new Error(`Chromium exited (${code}): ${diagnostics}`)));
browser.stdio[4].on('data', data => {
  buffer += data;
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    const item = pending.get(message.id);
    if (!item) continue;
    pending.delete(message.id);
    clearTimeout(item.timeout);
    if (message.error) item.reject(new Error(JSON.stringify(message.error)));
    else item.resolve(message.result);
  }
});
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out: ${diagnostics}`));
    }, 60000);
    pending.set(id, { resolve, reject, timeout });
    browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}

try {
  const jobs = JSON.parse(await readFile(jobFile, 'utf8'));
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  const { frameTree } = await send('Page.getFrameTree', {}, sessionId);
  let rendered = 0;
  for (const job of jobs) {
    const svg = await readFile(job.svg, 'utf8');
    let data;
    if (job.format === 'pdf') {
      // A 4-inch longest edge. SVG stays vector; backgrounds keep white artwork visible.
      const width = 4 * job.width / Math.max(job.width, job.height);
      const height = 4 * job.height / Math.max(job.width, job.height);
      const document = `<html><head><style>@page{size:${width}in ${height}in;margin:0}html,body{margin:0;width:100%;height:100%;background:${job.background};print-color-adjust:exact}svg{display:block;width:100%;height:100%}</style></head><body>${svg}</body></html>`;
      await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html: document }, sessionId);
      ({ data } = await send('Page.printToPDF', {
        printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false,
        paperWidth: width, paperHeight: height, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
      }, sessionId));
    } else {
      const url = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
      const expression = `(async () => {
        const img = new Image(); img.src = ${JSON.stringify(url)};
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = ${job.width}; canvas.height = ${job.height};
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png').split(',')[1];
      })()`;
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      data = result.result.value;
    }
    await mkdir(dirname(job.out), { recursive: true });
    await writeFile(job.out, Buffer.from(data, 'base64'));
    rendered++;
    if (rendered % 50 === 0) console.log(`Rendered ${rendered}/${jobs.length} assets`);
  }
  console.log(`Rendered ${rendered} assets directly from SVG.`);
} finally {
  browser.kill();
  rejectPending(new Error('Renderer closed'));
}
