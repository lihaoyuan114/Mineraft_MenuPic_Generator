# MC 菜单全景图生成器 · Mineraft MenuPic Generator

用**一张图**生成 Minecraft 主菜单的 360° 球面全景图（`panorama_0.png` ~ `panorama_5.png`），
浏览器里即可实时预览、调参，一键导出**可直接丢进 `.minecraft/resourcepacks/` 的资源包 ZIP**。

* 纯前端、零依赖、无需构建：`index.html` 双击就能跑，也能直接部署到 GitHub Pages。
* 所有图片处理都在本地浏览器完成，不上传任何数据。
* 内置数学自检 + 接缝检测，保证生成的立方体贴图在游戏里**无缝、不镜像、朝向正确**。

---

## 快速开始

**方式 A：直接打开**

```bash
git clone https://github.com/lihaoyuan114/Mineraft_MenuPic_Generator.git
cd Mineraft_MenuPic_Generator
# 双击 index.html，或者：
xdg-open index.html        # Linux
```

**方式 B：本地服务器**（非必需，但体验更稳）

```bash
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000/
```

**方式 C：在线**（仓库开启 GitHub Pages 后）

```
https://lihaoyuan114.github.io/Mineraft_MenuPic_Generator/
```

打开后会自动载入一张**示例全景图**，直接能看到效果。点「⬇ 下载资源包 ZIP」即可。

### 装进 Minecraft

1. 把下载到的 `.zip` **原样**放进 `.minecraft/resourcepacks/`
   （Windows：`%appdata%\.minecraft\resourcepacks\`）。
2. 启动游戏 → **选项 → 资源包** → 把该包移到右侧“已选” → 完成。
3. 回到主菜单，背景就是你的全景图了。

ZIP 内部结构（Minecraft 只认这个路径）：

```
assets/minecraft/textures/gui/title/background/panorama_0.png   ← 北 / 前
assets/minecraft/textures/gui/title/background/panorama_1.png   ← 东 / 右
assets/minecraft/textures/gui/title/background/panorama_2.png   ← 南 / 后
assets/minecraft/textures/gui/title/background/panorama_3.png   ← 西 / 左
assets/minecraft/textures/gui/title/background/panorama_4.png   ← 上 / 天顶
assets/minecraft/textures/gui/title/background/panorama_5.png   ← 下 / 天底
pack.mcmeta
pack.png        (资源包图标，自动生成)
```

> 资源包文件夹名/文件名可以是任意合法名称，只有 `assets/...` 里的路径和文件名不能改。

---

## 五种生成模式

| 模式 | 输入 | 做什么 | 适合 |
| --- | --- | --- | --- |
| **球面全景投影**（推荐） | 一张 2:1 等距柱状全景图 | 逐像素做球面 → 立方体投影，精确展开成 6 个 90° 视场面 | 全景照片、Blender/C4D 渲染的 equirect 全景、其它 360° 图 |
| **拼合图拆分** | 一张已经拼好的 6 面展开图 | 按 3×2 / 4×3 十字 / 6×1 长条等布局切成 6 份 | 已有 cubemap 拼合图、从别处导出的 skybox |
| **直接覆盖** | 任意图片 | 整图拉伸/裁切铺满每一面；可开「每面递进 90°」做旋转隧道 | 纯色/噪点/图案，或“六个面用同一张图” |
| **复制平铺** | 任意图片（小图更好） | 把图当瓷砖在每面平铺 N×N，可镜像拼接 | 无缝墙纸、方块材质、塔楼内部那种重复感 |
| **鱼眼转全景**（实验） | 圆形鱼眼（天顶）照片 | 先还原球面再展开成 6 面 | 全景相机导出的 fisheye、GoPro 单镜头 |

### 主要可选参数

* **每面分辨率** 512 / 1024 / 2048 / 4096（原版是 1024，推荐 1024）。
* **采样方式**：双线性（平滑）或最近邻（保留像素风）。
* **水平朝向 / 俯仰偏移 / 上下翻转 / 左右翻转**：调整全景图对准的方向，默认 0° 时图片水平中心 = 北。
* **调色**：亮度、对比度、饱和度，直接作用到输出。
* **高级 · 朝向修正**：上下互换、环向反转、整体水平旋转 90° —— 万一你的素材是按另一套约定做的，可以在这里救回来。
* **单面覆盖**：把某张图直接拖到右侧某个面的缩略图上即可单独替换；双击该面标题恢复自动生成。
* **URL 参数**：`index.html?mode=tile&tiles=4&fov=100&pitch=85&spin=0&seams=1&size=512`
  （`mode` / `size` / `layout` / `tiles` / `panoyaw` / `panopitch` / `fisheyefov` / `ringrot` /
  `viewyaw` / `pitch` / `fov` / `spin=0` / `seams=1` / `demo=0` / `check=1`）

---

## 实时预览与接缝自检

* 右侧预览是**从内部向外看**的软件光追（CPU 逐像素反查立方体面），和你进游戏看到的
  是同一套朝向，拖动即可环视，滚轮缩放视场，可开启「显示面分界」看 12 条棱的位置。
* 点「🔍 检查接缝」会比较每条棱两侧像素的差异，并和“面内相邻像素的平均差异”作对比。
  所有棱都低于阈值，才说明这张立方体贴图是**自洽无缝**的。

> 用示例全景图试一下：整张图是平滑的，所以接缝数值应当与基准噪声同量级（约 1~3）。
> 如果你手动把某个面转错 90°，对应那几条棱的数值会立刻飙升到几十。

---

## 正确性是怎么保证的

立方体贴图最容易错的就是**面的顺序与朝向**（镜像、上下面转错），错了在游戏里就是明显的裂缝。
本项目的约定、推导与验证都写在 **[docs/panorama-format.md](docs/panorama-format.md)**。

两条可复现的证据：

```bash
# 1) 几何 + 数值自检（无第三方依赖）
node tools/selftest.cjs
#    面内坐标↔方向互逆、24 条棱邻接关系、平滑全景投影后的接缝、
#    投影保真度（含“故意交换两个面则差异显著变大”的对照实验）、ZIP 可被标准工具解压

# 2) 用官方原版贴图反推（需要本地解出官方 client.jar，见脚本头部说明）
python3 tools/verify_vanilla_convention.py
```

第 2 项是最硬的证据：把 **Minecraft 1.20.1 官方 `client.jar` 里的原版 `panorama_0..5.png`**
按下标塞进槽位，枚举全部 4⁶ = 4096 种“每面旋转 k×90°”的组合，看哪种接缝最小。结果：

* 最优解**恰好是“不做任何变换”**（本项目约定），每条棱的接缝差异 7.13，而图片内部相邻像素的
  自然差异是 6.51 —— 只差 1.10 倍，即棱上的跳变和图片内部的正常跳变一样小，**完全无缝**；
* 第二好解（下面那张转 180°）差 1.46 倍，最差解差 6.5 倍 —— 结论无歧义。

---

## 常见问题

**图片比例不是 2:1 行吗？**
球面投影模式下不是 2:1 也能用，但会被拉伸；工具会在输入信息里标黄提醒。
想效果最好就把全景图裁成 2:1（例如 4096×2048）。

**一定得是 1024×1024 吗？**
原版 panorama 是 1024×1024，绝大多数资源包也用这个尺寸，最保险。512 / 2048 一般也能用。
本工具导出的一定是正方形。

**游戏里提示资源包是为其它版本制作的？**
把「目标版本」改成你实际玩的版本即可（不同版本 `pack_format` 不同）。
这个提示不影响加载，只是需要你点一下确认。

**游戏里出现裂缝 / 上下颠倒怎么办？**
先点「检查接缝」。如果是“拼合图拆分”模式，八成是布局选错了（看源图上的网格编号）；
如果是球面投影模式，检查素材本身是否左右镜像。仍不对就用「高级 · 朝向修正」。

**为什么不用 GPU / WebGL？**
纯 Canvas 2D + 自己写的采样循环，避免任何依赖与兼容性问题，`file://` 直开也能跑。
1024 尺寸下单次生成大约几百毫秒。

---

## 目录结构

```
index.html              界面
assets/style.css        样式
assets/icon.svg         图标
js/cubemap.js           核心数学：面序约定、球面投影、各模式、接缝检测、预览渲染
js/zip.js               极简 ZIP 打包器（自带 CRC-32，store 模式）
js/app.js               界面逻辑与导出
tools/selftest.cjs      Node 自检脚本（无第三方依赖）
tools/verify_vanilla_convention.py  用官方原版贴图反推面序约定的验证脚本（Python，仅标准库）
tools/ci/deploy-pages.yml          可选的 GitHub Actions 部署工作流（先跑自检再发布 Pages）
docs/panorama-format.md 全景图格式与面序约定（含推导与实测证据）
docs/repo-settings.md   仓库设置：分支保护 / 规则集（只能创建新分支的问题）
```

## 开发

没有构建步骤，改完直接刷新浏览器。改核心数学后请跑一遍 `node tools/selftest.cjs`。

## 许可

MIT，见 [LICENSE](LICENSE)。本项目与 Mojang / Microsoft 无关，“Minecraft”是 Mojang Synergies AB 的商标。
