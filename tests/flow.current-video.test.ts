import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { chromium, type APIResponse } from "playwright";
import { FlowPage } from "../src/flow/page.js";
import { UiContractError } from "../src/errors.js";

function videoFixture(with360p: boolean): string {
  return `<!doctype html><main>
    <div class="ProseMirror" contenteditable="true"></div>
    <button id="settings">Veo 3.1 - Fast crop_9_16 x2</button>
    <button id="generate" aria-label="Start generation" disabled>arrow_forward</button>
    <div class="cdk-overlay-pane" hidden>
      <button role="radio" data-key="type" data-value="image">imageImage</button>
      <button role="radio" data-key="type" data-value="video">videocamVideo</button>
      <button role="radio">chrome_extensionIngredients</button>
      <button role="radio" data-key="ratio" data-value="16:9">crop_16_916:9</button>
      <button id="model">Veo 3.1 - Fast arrow_drop_down</button>
      <div role="menu" hidden><button role="menuitem" id="omni">volume_upOmni 1.1 Flash</button></div>
      ${with360p ? '<button role="radio" aria-checked="false" data-key="resolution" data-value="360p">360pinfo</button>' : ''}
      <button role="radio" aria-checked="true" data-key="resolution" data-value="720p">720p</button>
      <button role="radio" data-key="duration" data-value="4">4s</button>
      <button role="radio" data-key="outputs" data-value="1">x1</button>
    </div><section id="results"></section>
  </main><script>
    const config = { type: 'image', model: 'Veo 3.1 - Fast', resolution: '720p', duration: '8', ratio: '9:16', outputs: '2' };
    const overlay = document.querySelector('.cdk-overlay-pane');
    const menu = document.querySelector('[role=menu]');
    const prompt = document.querySelector('.ProseMirror');
    const generate = document.querySelector('#generate');
    document.querySelector('#settings').onclick = () => { overlay.hidden = !overlay.hidden; };
    document.querySelector('#model').onclick = () => { menu.hidden = !menu.hidden; };
    document.querySelector('#omni').onclick = () => {
      config.model = 'Omni 1.1 Flash';
      config.resolution = '720p'; config.duration = '8'; config.ratio = '9:16'; config.outputs = '2';
      document.querySelector('#model').textContent = 'Omni 1.1 Flash arrow_drop_down';
      menu.hidden = true;
    };
    document.querySelectorAll('[data-key]').forEach(button => button.onclick = () => {
      config[button.dataset.key] = button.dataset.value;
      document.querySelectorAll('[data-key="' + button.dataset.key + '"]').forEach(peer => peer.setAttribute('aria-checked', String(peer === button)));
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!menu.hidden) menu.hidden = true; else overlay.hidden = true; } });
    prompt.addEventListener('input', () => { generate.disabled = !prompt.textContent.trim(); });
    generate.onclick = () => {
      generate.dataset.submitted = 'true';
      const payload = JSON.stringify({ ...config, prompt: prompt.textContent });
      const video = document.createElement('video');
      video.src = 'https://flow.google.com/asb/fixture-video=mm,18,15';
      video.width = video.height = 40;
      video.onclick = () => {
        const download = document.createElement('button');
        download.textContent = 'download Download';
        download.onclick = () => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([payload], { type: 'video/mp4' }));
          a.download = 'result.mp4'; a.click();
        };
        document.body.appendChild(download);
      };
      const tile = document.createElement('flow-video-tile');
      tile.style.cssText = 'display:inline-block;width:40px;height:40px';
      tile.onmouseenter = () => { if (!tile.querySelector('video')) tile.appendChild(video); };
      document.querySelector('#results').appendChild(tile);
    };
  </script>`;
}

describe("current Flow video settings", () => {
  it.each(["available", "unavailable", "evicted-download"])("handles the requested resolution and download (%s)", async (scenario) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.route("https://flow-content.google/**", route => route.abort());
      await page.route("https://flow.google.com/asb/**", route => route.abort());
      await page.setContent(videoFixture(scenario !== "unavailable"));
      const expected = {
        type: "video", model: "Omni 1.1 Flash", resolution: "360p", duration: "4", ratio: "16:9", outputs: "1", prompt: "A red boat"
      };
      const fetchMedia = scenario === "evicted-download" ? vi.spyOn(page.context().request, "get").mockResolvedValue({
        ok: () => true,
        headers: () => ({ "content-type": "video/mp4" }),
        body: async () => Buffer.from(JSON.stringify(expected))
      } as unknown as APIResponse) : undefined;
      if (fetchMedia) {
        page.on("download", download => { vi.spyOn(download, "saveAs").mockRejectedValue(new Error("ENOENT: temporary download file is missing")); });
      }
      const outDir = await mkdtemp(join(tmpdir(), "gflow-current-video-"));
      const input = {
        job: { id: "omni-360", type: "video" as const, model: "Omni 1.1 Flash", resolution: "360p" as const,
          duration: 4, ratio: "16:9", prompt: "A red boat", outputs: 1, out: outDir, ingredients: [], character: [] },
        outDir
      };
      const flow = new FlowPage(page);
      if (scenario === "unavailable") {
        await expect(flow.runJob(input)).rejects.toBeInstanceOf(UiContractError);
        expect(await page.locator('#generate').getAttribute('data-submitted')).toBeNull();
        return;
      }
      const result = await flow.runJob(input);
      expect(JSON.parse(await readFile(result.artifacts[0].path, "utf8"))).toEqual(expected);
      if (fetchMedia) expect(fetchMedia).toHaveBeenCalledWith("https://flow.google.com/asb/fixture-video=mm,18,15");
      expect(JSON.parse(await readFile(result.artifacts[0].metadataPath, "utf8"))).toMatchObject({ resolution: "360p" });
    } finally {
      await browser.close();
    }
  });
});
