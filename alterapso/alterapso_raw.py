#!/usr/bin/env python3
"""
Vita Altera (alterapso.com) 每日原始数据爬虫 —— 原样下载，不做任何格式转换。

适合每天定时跑一次，输出目录直接给网站用：
  * 所有文件按网址路径原样保存（字节完全一致）。
  * JSON 先下到临时目录，全部下载并校验通过后才替换正式目录；
    任何一个失败就整次放弃，正式目录保持上一次的完好数据，退出码 1。
  * 图片增量下载：已有的不重复下。
  * _manifest.json 记录每个文件的网址、大小、sha256，以及和上一次相比哪些文件变了。

下载内容（与官网前端实际请求的一致）:
  glossary-data/index.json          物品目录（1,200+ 件：代码、名字、类别、星级、图片名）
  glossary-data/d0.json ~ df.json   物品详情 16 个分片：说明介绍、属性、需求、可装备职业、获取方式
                                    （官网按 物品代码(十六进制) % 16 分片）
  glossary-data/bestiary.json       怪物图鉴（属性、抗性、旧版按 ID 掉落表、物品名表）
  glossary-data/gacha.json          现行掉落池（阶层、概率、ARR、传说/特殊掉落）
  news.json                         官网新闻
  web/v1/status, web/v1/festival    服务器状态、活动进度（实时接口）
  图片（默认下载，--no-images 关闭）:
    glossary-data/art/*.webp        物品图标
    glossary-data/equip/<代码>.webp  装备外观图（目录里 e=1 的物品）
    glossary-data/enemies/<怪>.webp  怪物图（p=1），极限版 <怪>-u.webp（pu=1）

用法:
  python alterapso_raw.py                          # 输出到 脚本所在文件夹\alterapso_data
  python alterapso_raw.py -o D:\\www\\alterapso     # 指定网站数据目录
  python alterapso_raw.py --no-images              # 不下载图片（默认 JSON + 图片 + 实时接口全下）
  python alterapso_raw.py --archive D:\\alterapso_history   # 有变化时另存一份日期快照

只用 Python 标准库，Python 3.8+。
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

SITE = "https://alterapso.com"
UA = "Mozilla/5.0 (compatible; alterapso-raw/2.0)"
SHARDS = "0123456789abcdef"
MANIFEST = "_manifest.json"


class NotFound(Exception):
    pass


def log(*a):
    print(datetime.now().strftime("%H:%M:%S"), *a, flush=True)


def fetch(url, kind, retries=3):
    """
    下载并返回原始字节。kind = "json" 或 "image"。
    注意：该站对不存在的路径返回 200 + 首页 HTML，不是 404，
    所以必须检查 Content-Type / 内容开头，否则会把 HTML 当数据存下来。
    """
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Cache-Control": "no-cache"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
                ctype = (r.headers.get("Content-Type") or "").lower()
            if "text/html" in ctype or data[:15].lstrip().lower().startswith((b"<!doctype", b"<html")):
                raise NotFound(f"不存在（服务器返回了网页而不是文件）: {url}")
            if kind == "json":
                json.loads(data)  # 只校验能解析，保存的仍是原始字节
            elif kind == "image" and not ctype.startswith("image/"):
                raise NotFound(f"不是图片（{ctype}）: {url}")
            return data
        except NotFound:
            raise
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise NotFound(f"404: {url}")
            last = e
            if e.code in (401, 403):  # 没有权限，重试也没用
                break
        except Exception as e:
            last = e
        time.sleep(2 * (i + 1))
    raise RuntimeError(f"下载失败 {url}: {last}")


def write_bytes(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load_manifest(outdir):
    try:
        with open(os.path.join(outdir, MANIFEST), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def crawl_json(api):
    """返回 [(相对路径, 网址, 字节)]；任何必需文件失败都会抛异常。"""
    files = []

    def grab(rel, query="", required=True):
        url = f"{SITE}/{rel}" + (f"?{query}" if query else "")
        try:
            data = fetch(url, "json", retries=3 if required else 1)
        except Exception as e:
            if required:
                raise RuntimeError(str(e))
            # 可选文件（新闻、实时接口）失败不影响本次结果；
            # 实时接口可能需要浏览器登录状态，脚本访问会被 403 拒绝
            log("跳过（可选）", rel, "-", e)
            return None
        files.append((rel, url, data))
        log(f"{rel:<34}{len(data):>10,} bytes")
        return data

    index_raw = grab("glossary-data/index.json")
    index = json.loads(index_raw)
    version = index.get("version", "")
    for h in SHARDS:
        grab(f"glossary-data/d{h}.json", f"v={version}" if version else "")
    grab("glossary-data/bestiary.json")
    grab("glossary-data/gacha.json")
    grab("news.json", required=False)
    if api:
        grab("web/v1/status", required=False)
        grab("web/v1/festival", required=False)

    # 校验：16 个详情分片合起来应正好覆盖目录里的全部物品
    detail = {}
    for rel, _, data in files:
        if rel.startswith("glossary-data/d") and len(rel) == len("glossary-data/d0.json"):
            detail.update(json.loads(data))
    codes = {it["c"] for it in index.get("items", [])}
    missing = codes - set(detail)
    if missing:
        raise RuntimeError(f"详情分片缺少 {len(missing)} 件物品（官网可能改了分片方式），例如 {sorted(missing)[:5]}")
    log(f"校验通过：目录 {len(codes)} 件物品，详情 {len(detail)} 件")
    return files, index


def image_list(index, bestiary):
    rels = set()
    for it in index.get("items", []):
        if it.get("a"):
            rels.add(f"glossary-data/art/{it['a']}")
        if it.get("e"):
            rels.add(f"glossary-data/equip/{it['c']}.webp")
    for v in (bestiary.get("items") or {}).values():
        if isinstance(v, list) and len(v) > 2 and v[2]:
            rels.add(f"glossary-data/art/{v[2]}")
    for e in bestiary.get("enemies", []):
        if e.get("p"):
            rels.add(f"glossary-data/enemies/{e['k']}.webp")
        if e.get("pu"):
            rels.add(f"glossary-data/enemies/{e['k']}-u.webp")
    return sorted(rels)


def crawl_images(outdir, rels, workers, refresh):
    todo = [r for r in rels if refresh or not os.path.exists(os.path.join(outdir, *r.split("/")))]
    log(f"图片：共 {len(rels)} 张，需要下载 {len(todo)} 张")
    ok, bad = 0, []

    def one(rel):
        data = fetch(f"{SITE}/{rel}", "image")
        dest = os.path.join(outdir, *rel.split("/"))
        write_bytes(dest + ".part", data)
        os.replace(dest + ".part", dest)
        return rel

    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(one, r): r for r in todo}
        for f in futs:
            try:
                f.result()
                ok += 1
            except Exception as e:  # 单张图片失败不影响整体
                bad.append(f"{futs[f]}: {e}")
    log(f"图片：成功 {ok}，失败 {len(bad)}")
    for b in bad[:20]:
        log("  失败", b)
    return ok, bad


def main():
    ap = argparse.ArgumentParser(description="每日原样下载 alterapso.com 图鉴原始数据")
    ap.add_argument("-o", "--out", help="输出目录（网站读取的目录），默认为本脚本所在文件夹下的 alterapso_data")
    ap.add_argument("--no-images", dest="images", action="store_false", help="不下载图片（默认会下载物品图标、装备图、怪物图，增量）")
    ap.add_argument("--images", dest="images", action="store_true", help=argparse.SUPPRESS)  # 兼容旧参数
    ap.add_argument("--refresh-images", action="store_true", help="图片全部重新下载")
    ap.add_argument("--no-api", dest="api", action="store_false", help="不抓实时接口 web/v1/status、web/v1/festival（默认会抓）")
    ap.add_argument("--api", dest="api", action="store_true", help=argparse.SUPPRESS)  # 兼容旧参数
    ap.add_argument("--archive", metavar="DIR", help="数据有变化时，另存一份 JSON 快照到 DIR/<日期时间>/")
    ap.add_argument("--workers", type=int, default=4, help="图片并发数，默认 4")
    a = ap.parse_args()

    # 默认放在脚本自己的文件夹下，不受在哪个目录运行影响
    here = os.path.dirname(os.path.abspath(__file__))
    outdir = os.path.abspath(a.out) if a.out else os.path.join(here, "alterapso_data")
    os.makedirs(outdir, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    tmp = os.path.join(outdir, f".tmp-{stamp}")
    log("输出目录", outdir)

    try:
        files, index = crawl_json(a.api)
    except Exception as e:
        log("失败，正式目录未改动：", e)
        sys.exit(1)

    # 先全部写到临时目录，再逐个替换进正式目录
    for rel, _, data in files:
        write_bytes(os.path.join(tmp, *rel.split("/")), data)
    prev = {f["path"]: f["sha256"] for f in load_manifest(outdir).get("files", [])}
    entries, changed = [], []
    for rel, url, data in files:
        dest = os.path.join(outdir, *rel.split("/"))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        os.replace(os.path.join(tmp, *rel.split("/")), dest)
        h = sha(data)
        entries.append({"path": rel, "url": url, "bytes": len(data), "sha256": h})
        if prev.get(rel) != h:
            changed.append(rel)
    shutil.rmtree(tmp, ignore_errors=True)
    log("变化的文件：", ", ".join(changed) if changed else "无")

    img = None
    if a.images:
        bestiary = json.loads(next(d for r, _, d in files if r == "glossary-data/bestiary.json"))
        ok, bad = crawl_images(outdir, image_list(index, bestiary), a.workers, a.refresh_images)
        img = {"downloaded": ok, "failed": bad}

    manifest = {
        "site": SITE,
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "glossary_version": index.get("version"),
        "items": len(index.get("items", [])),
        "changed": changed,
        "images": img,
        "files": entries,
    }
    with open(os.path.join(outdir, MANIFEST), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)

    if a.archive and changed:
        snap = os.path.join(os.path.abspath(a.archive), stamp)
        for rel, _, _ in files:
            src = os.path.join(outdir, *rel.split("/"))
            dst = os.path.join(snap, *rel.split("/"))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
        shutil.copy2(os.path.join(outdir, MANIFEST), os.path.join(snap, MANIFEST))
        log("快照已保存到", snap)

    log(f"完成：{len(files)} 个 JSON，{len(changed)} 个有变化")


if __name__ == "__main__":
    main()
