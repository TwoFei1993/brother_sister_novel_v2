# -*- coding: utf-8 -*-
"""S5-F2 4MP 重出（单进程模式）：每张图一个 ComfyUI 进程，出图立即 kill。
彻底绕开卸载路径的 access violation，同时保证干净内存状态。
"""
import importlib.util, os, shutil, sys, time
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
spec = importlib.util.spec_from_file_location("b", r"D:\ComfyUISetup\h3-batch.py")
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

W, H, SEED = 1536, 2688, 42
DST = os.path.join(b.OUT, "h3-S5-F2-4mp.png")

files = [f"{b.IMGDIR}\\魏无痕-特写.png", f"{b.IMGDIR}\\陆惊尘-特写.png",
         f"{b.IMGDIR}\\宗门比剑台-场景.png", f"{b.IMGDIR}\\沈青鸾-特写.png"]
prompt = b.to_picture(b.s5_surgery(b.NEW["S5-F2"]))


def alive() -> bool:
    try:
        b.api("/system_stats", timeout=8)
        return True
    except Exception:
        return False


for attempt in range(1, 4):
    print(f"=== attempt {attempt} ===", flush=True)
    b.kill_comfy()
    time.sleep(3)
    if not b.launch_comfy():
        print("LAUNCH FAILED", flush=True)
        sys.exit(1)
    t0 = time.time()
    try:
        images = [b.upload(f) for f in files]
        r = b.api("/prompt", b.build(prompt, SEED, W, H, images))
        pid = r["prompt_id"]
        print("submitted", pid, flush=True)
    except Exception as e:
        print("submit failed:", e, flush=True)
        continue
    done = False
    while True:
        time.sleep(15)
        if not alive():
            print(f"comfy died mid-run at {int(time.time()-t0)}s", flush=True)
            break
        try:
            hist = b.api(f"/history/{pid}")
        except Exception:
            print("http stall (still loading?), keep waiting", flush=True)
            continue
        if pid in hist:
            got = False
            for _, o in hist[pid].get("outputs", {}).items():
                for im in o.get("images", []):
                    src = os.path.join(r"D:\ComfyUI\ComfyUI\output", im["subfolder"], im["filename"])
                    shutil.copy(src, DST)
                    print("saved", DST, flush=True)
                    got = True
            if got:
                done = True
                break
            if hist[pid].get("status", {}).get("status_str") in ("error", "failed"):
                print("task failed", flush=True)
                break
    b.kill_comfy()
    if done:
        print(f"ALL_DONE {int(time.time()-t0)}s", flush=True)
        sys.exit(0)
print("GAVE_UP after 3 attempts", flush=True)
sys.exit(1)
