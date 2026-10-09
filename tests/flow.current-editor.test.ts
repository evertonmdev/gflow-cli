import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { FlowPage } from "../src/flow/page.js";
import { UiContractError } from "../src/errors.js";

// Current Angular editor: unlabelled ProseMirror, icon-only submit, CDK overlays,
// and x1/x2 output controls. Start at x2 so a missed selection cannot pass.
function editorFixture(withOutputOptions = true): string {
  return `<!doctype html><main>
    <div class="ProseMirror" contenteditable="true"><p><br></p></div>
    <button id="settings">Nano Banana 2.1 crop_16_9 x2</button>
    <button id="generate" aria-label="Start generation" disabled>arrow_forward</button>
    <div class="cdk-overlay-pane" hidden>
      <button role="radio">imageImage</button>
      ${withOutputOptions ? '<button id="one" role="radio">x1</button><button role="radio">x2</button>' : ''}
    </div>
    <section id="results"></section>
  </main><script>
    const prompt = document.querySelector('.ProseMirror');
    const generate = document.querySelector('#generate');
    const overlay = document.querySelector('.cdk-overlay-pane');
    let outputs = 2;
    document.querySelector('#settings').onclick = () => { overlay.hidden = !overlay.hidden; };
    document.querySelector('#one')?.addEventListener('click', () => { outputs = 1; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') overlay.hidden = true; });
    prompt.addEventListener('input', () => { generate.disabled = !prompt.textContent.trim(); });
    generate.onclick = () => {
      if (!overlay.hidden) throw new Error('Settings still cover the prompt');
      generate.dataset.submitted = String(outputs);
      const payload = JSON.stringify({ outputs, prompt: prompt.textContent });
      const image = document.createElement('img');
      image.src = 'https://flow-content.google/image/fixture-image';
      image.width = image.height = 40;
      image.onclick = () => {
        const download = document.createElement('button');
        download.textContent = 'download Download';
        download.onclick = () => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([payload], { type: 'image/png' }));
          a.download = 'result.png';
          a.click();
        };
        document.body.appendChild(download);
      };
      document.querySelector('#results').appendChild(image);
    };
  </script>`;
}

describe("current Flow editor", () => {
  it.each(["", "/edit/33434052-819a-4baf-b584-94ece401f23d"])("opens the generation editor from project path %s and downloads one output", async (subpath) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const url = "https://flow.google.com/project/11111111-2222-4333-8444-555555555555";
      await page.route("https://flow.google.com/**", route => route.fulfill({ contentType: "text/html", body: editorFixture() }));
      await page.route("https://flow-content.google/**", route => route.fulfill({
        contentType: "image/png",
        body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII=", "base64")
      }));
      await page.goto(`${url}${subpath}`);
      const flow = new FlowPage(page);
      await flow.open();
      expect(page.url()).toBe(url);
      await expect(flow.assertReady()).resolves.toBeUndefined();
      const outDir = await mkdtemp(join(tmpdir(), "gflow-current-editor-"));
      const result = await flow.runJob({
        job: { id: "boat", type: "image", prompt: "Um barco vermelho num lago", outputs: 1, out: outDir, ingredients: [], character: [] },
        outDir
      });
      expect(result.artifacts).toHaveLength(1);
      expect(JSON.parse(await readFile(result.artifacts[0].path, "utf8"))).toEqual({ outputs: 1, prompt: "Um barco vermelho num lago" });
    } finally {
      await browser.close();
    }
  });

  it("stops before submission if the output count cannot be selected", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(editorFixture(false));
      const flow = new FlowPage(page);
      await expect(flow.runJob({
        job: { id: "boat", type: "image", prompt: "A boat", outputs: 1, out: tmpdir(), ingredients: [], character: [] },
        outDir: tmpdir()
      })).rejects.toBeInstanceOf(UiContractError);
      expect(await page.locator('#generate').getAttribute('data-submitted')).toBeNull();
    } finally {
      await browser.close();
    }
  });
});
