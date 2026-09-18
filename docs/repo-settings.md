# 仓库设置：为什么“提交只能创建新分支”，怎么改

> 你问的“递交只能创建新分支”，在 GitHub 上通常是下面四件事之一。本文先给**实测结论**，
> 再给**逐项排查表**和**具体改法**（网页 / `gh` / `curl` 三种）。

---

## 0. 实测结论（本仓库，2026-09）

> ⚠️ **一个重要的方法论教训**：`GET /repos/{owner}/{repo}/branches` 返回的 `protected` 字段，
> 对**未认证**的匿名请求**不可信**（本仓库匿名读到的是 `false`，认证后证明是 `true`）。
> `/rules/branches/{branch}` 匿名请求也会静默返回 `[]`。
> **判断分支保护必须用认证后的 `branches/{branch}/protection` 接口。**

### 0.1 认证后的真实状态

```bash
gh api repos/lihaoyuan114/Mineraft_MenuPic_Generator/branches/main/protection
```

```json
{
  "required_pull_request_reviews": { "required_approving_review_count": 1 },
  "enforce_admins":                 { "enabled": false },
  "allow_force_pushes":             { "enabled": false },
  "allow_deletions":                { "enabled": false },
  "required_linear_history":        { "enabled": false },
  "lock_branch":                    { "enabled": false }
}
```

结论：

* **`main` 有一条经典分支保护规则**，勾选了 **Require a pull request before merging**，
  且要求 **1 个批准**。这就是"只能创建新分支"的真正原因 —— 网页端在要求 PR 时，
  提交框只会给出"新建分支 + 发起 PR"这一个选项。
* 但 `enforce_admins = false`（"Do not allow bypassing the above settings" 没勾），
  **所以管理员本人可以绕过**，直接 `git push origin main` 其实也能成功。
* 注意个人仓库只有你一个人时，`required_approving_review_count = 1` 等于把自己锁死
  （没人能批准你的 PR）。合理的个人仓库配置是把它改成 **0**：仍然强制走 PR（保留可追溯性），
  但不需要别人批准。本项目已经改成 0。

```bash
# 把"要求 1 个批准"改成不需要批准（推荐）
gh api -X PATCH repos/lihaoyuan114/Mineraft_MenuPic_Generator/branches/main/protection/required_pull_request_reviews \
  -f required_approving_review_count=0
```

### 0.2 与 push 403 的关系（两件不同的事）

"只能创建新分支"（分支保护）和实际 push 时报的 403（`Permission to … denied to …`）
**是两回事**，前者是仓库策略，后者是凭据权限。当初真正的 403 原因是：

```
Token scopes: 'gist', 'read:org', 'repo'          ← gh 补了 repo 之后才能推
之前用的 token 连 public_repo / repo 都没有，所以连自己的仓库都推不动。
```

认证后确认账号本身权限完全正常：

```bash
gh api repos/lihaoyuan114/Mineraft_MenuPic_Generator --jq .permissions
# {"admin":true,"maintain":true,"pull":true,"push":true,"triage":true}
```

所以**不是**被 GitHub flagged，纯粹是 token scope 问题。

---

## 1. 排查表：看到什么报错 = 什么问题

| 你看到的 | 真正原因 | 改哪里 |
| --- | --- | --- |
| `remote: error: GH006: Protected branch update failed for refs/heads/main` | **经典分支保护规则**（Settings → Branches） | 见 §2 |
| `remote: error: GH013: Repository rule violations found` | **仓库/组织规则集 Rulesets**（Settings → Rules） | 见 §3 |
| `You're not a contributor / 你没有权限` + 只给“新建分支”选项 | 你在用**没有写权限的账号**，或仓库是别人的 | 见 §4 |
| `! [rejected] main -> main (non-fast-forward)` | 本地落后于远端，**不是保护** | `git pull --rebase` 后重推 |
| 网页上点“编辑文件”后，提交框**只有** “Create a new branch…” 一项 | 网页编辑器默认流程；或你没有写权限 | 见 §4 |
| `Permission to <repo>.git denied to <user>` + 403 | **token 没带写权限**（classic PAT 没勾 `repo`，或 fine-grained PAT 没选这个仓库/没给 Contents:write）。注意：owner 本人也会被这条挡住，所以别误判成"账号被限" | 见 §5 |
| `refusing to allow an OAuth App to create or update workflow ... without 'workflow' scope` | token 缺 **`workflow`** scope，而你要推的文件在 `.github/workflows/` 下。**整个 push 会被拒绝，与分支保护无关** | 见 §7 末尾 |

---

## 2. 经典分支保护规则（Branch protection rules）

**在网页上查看 / 修改**

1. 打开 `https://github.com/lihaoyuan114/Mineraft_MenuPic_Generator/settings/branches`
   （仓库 → **Settings** → 左侧 **Branches**）
2. 看到 `Branch protection rules` 列表里如果有 `main`，点它右边的 **Edit**。
3. 你要找的关键开关是：
   * **Require a pull request before merging** —— 勾上就**禁止直接 push**，必须走 PR。
     取消勾选 = 允许直接 push 到 main。
   * **Lock branch** —— 勾上则该分支完全只读（连 PR 合并都要靠 bypass）。
   * **Restrict who can push to matching branches** —— 把能 push 的人限制成白名单。
4. 改完点最下面的 **Save changes**。
5. 想彻底不要保护：在列表里点 **Delete**。

> 直接 push 被拒绝的最常见原因就是 **Require a pull request before merging**。

**用 `gh` 命令行**

```bash
# 看有没有保护（需要 admin 权限）
gh api repos/lihaoyuan114/Mineraft_MenuPic_Generator/branches/main/protection

# 完全删除保护
gh api -X DELETE repos/lihaoyuan114/Mineraft_MenuPic_Generator/branches/main/protection

# 只关掉“必须走 PR”
gh api -X PATCH repos/lihaoyuan114/Mineraft_MenuPic_Generator/branches/main/protection/required_pull_request_reviews \
  -f required_approving_review_count=0
```

**用 `curl`（需要一个有 admin 权限的 token）**

```bash
TOKEN=ghp_xxxxxxxxxxxxxxxx        # 不要提交到仓库，不要贴到聊天里
REPO=lihaoyuan114/Mineraft_MenuPic_Generator

# 查询
curl -sH "Authorization: Bearer $TOKEN" \
     -H "Accept: application/vnd.github+json" \
     https://api.github.com/repos/$REPO/branches/main/protection

# 删除
curl -sX DELETE -H "Authorization: Bearer $TOKEN" \
     -H "Accept: application/vnd.github+json" \
     https://api.github.com/repos/$REPO/branches/main/protection
```

---

## 3. 规则集（Rulesets，GitHub 较新的机制）

**网页**：仓库 → **Settings** → 左侧 **Rules** → **Rulesets**
找到作用在 `main` 上的规则集，点进去可以：
* **Disabled** —— 临时停用；
* **Edit** → 在 **Bypass list** 里把自己（或 `Repository admin`）加进去；
* 或者直接 **Delete**。
* 让人不能直接 push 的那条是 **Restrict updates** / **Require a pull request before merging**。

**命令**

```bash
# 列出仓库规则集（公开仓库无需 token 即可读）
gh api repos/lihaoyuan114/Mineraft_MenuPic_Generator/rulesets

# 查看某条规则集的详情（<id> 从上一步拿到）
gh api repos/lihaoyuan114/Mineraft_MenuPic_Generator/rulesets/<id>

# 停用 / 删除
gh api -X PUT    repos/lihaoyuan114/Mineraft_MenuPic_Generator/rulesets/<id> -f enforcement=disabled
gh api -X DELETE repos/lihaoyuan114/Mineraft_MenuPic_Generator/rulesets/<id>
```

> 注意：如果是**组织级**规则集，仓库设置里只能查看不能改，要去
> `https://github.com/organizations/<org>/settings/rules`。本仓库属于个人账号（User），不存在这种情况。

`rulesets` 是公开可读的，本仓库实测为 `[]`，所以**不是**这个原因。

---

## 4. 身份 / 权限 / 网页编辑器

* **网页上只有“新建分支”选项**：GitHub 网页编辑器在你有写权限时，默认就有
  “Commit directly to the `main` branch”这一项；如果**看不到**这一项，说明当前登录账号
  对这个仓库没有写权限（只是只读协作者 / 不是协作者）。解决办法：
  * 确认右上角登录的是 `lihaoyuan114`；
  * 仓库 → **Settings → Collaborators** 把自己加成 `Write` 或 `Admin`；
  * 或者接受现实，走“新建分支 + PR”的流程（这本来就是开源协作的标准做法）。
* 注意网页编辑器会**记住上次选择**，有时默认停在 “Create a new branch…”，手动切回
  “Commit directly to the `main` branch” 即可。

---

## 5. 本地 push 的凭据配置（本机当前的问题）

本机实测：`git config --global credential.helper=libsecret`，但 **libsecret 里没有任何
github.com 的条目**，也没有 `gh` CLI、没有 `~/.git-credentials`。所以现在直接 push 会报：

```
fatal: could not read Username for 'https://github.com': terminal prompts disabled
```

三种修法，任选其一：

**A. 用 GitHub CLI（最省事，能存凭据 + 能改仓库设置）**

```bash
# 安装（Arch/CachyOS）
sudo pacman -S github-cli
gh auth login          # 选 HTTPS → 用浏览器登录（会自动配好 git 凭据）
gh auth status
```

**B. 用 Personal Access Token**

1. 打开 <https://github.com/settings/tokens> → **Generate new token (classic)**
   或 Fine-grained token；
2. 勾权限：只推送代码要 `repo`；**要改分支保护/规则集还需要 `admin:repo_hook`+仓库 Admin**
   （classic token 的 `repo` 已含仓库管理；fine-grained 选
   `Administration: Read and write` + `Contents: Read and write`）；
3. 存起来，别写进仓库文件：

```bash
# 让 git 记住（存进系统的 libsecret）
git config --global credential.helper libsecret
git push origin main        # 提示时用户名填 GitHub 用户名，密码处粘贴 token
```

**C. 用 SSH key**

```bash
ssh-keygen -t ed25519 -C "lihaoyuan525@outlook.com"
cat ~/.ssh/id_ed25519.pub       # 复制到 https://github.com/settings/keys
git remote set-url origin git@github.com:lihaoyuan114/Mineraft_MenuPic_Generator.git
ssh -T git@github.com
```

---

## 6. 如果确实要保留“必须走 PR”，怎么干活

保留保护其实是个好习惯。日常流程：

```bash
# 每次改动都开新分支
git checkout -b feat/xxx
git add -A && git commit -m "feat: ..."
git push -u origin feat/xxx

# 然后用 gh 直接开 PR 并合并
gh pr create --fill --base main
gh pr merge --squash --delete-branch
```

本次工作就是按这个流程准备的：代码提交在分支 `feat/panorama-generator` 上
（`main` 也指向同一个提交，方便你二选一）：

```bash
cd Mineraft_MenuPic_Generator

# 方案一：走 PR（推荐，也是被保护时唯一可行的）
git push -u origin feat/panorama-generator
# 然后打开 GitHub 给你的链接，点 “Create pull request” → “Merge”

# 方案二：直接推 main
git push origin main
```

---

## 7. 顺带：让这个工具变成在线版（GitHub Pages）

这个项目是**纯静态站点**，所以最省事的做法是"从分支部署"，不需要任何 CI、不需要额外 token 权限：

1. 仓库 → **Settings → Pages**；
2. **Source** 选 **Deploy from a branch**；
3. Branch 选 **`main`**，目录选 **`/ (root)`**，点 **Save**；
4. 等 1 分钟左右，访问 `https://lihaoyuan114.github.io/Mineraft_MenuPic_Generator/`。

因为 `index.html` 在仓库根目录、且全部是相对路径（`assets/…`、`js/…`），所以根目录直接就能跑。

### 可选：用 Actions 部署（会先跑自检）

仓库里额外放了一份工作流模板 **`tools/ci/deploy-pages.yml`**，它会先执行 `node tools/selftest.cjs`
（不通过就不部署）再发布。想启用的话：

```bash
mkdir -p .github/workflows
git mv tools/ci/deploy-pages.yml .github/workflows/deploy-pages.yml
git commit -m "ci: 启用 Pages 部署工作流"
git push
```

然后把 **Settings → Pages → Source** 改成 **GitHub Actions**。

> ⚠️ 注意：**推送任何 `.github/workflows/**` 下的文件，你的 token 必须带 `workflow` scope**，
> 否则 GitHub 会直接拒绝整个 push：
> ```
> ! [remote rejected] ... (refusing to allow an OAuth App to create or update
>   workflow `.github/workflows/xxx.yml` without `workflow` scope)
> ```
> 这是 GitHub 的安全设计（防止低权限 token 偷塞 CI 脚本读 secrets），**和仓库设置、分支保护都无关**。
> 三种解法：
> 1. `gh auth refresh -h github.com -s workflow`（给现有 token 补权限，推荐）；
> 2. 建 classic PAT 时勾上 **`workflow`**；
> 3. 用 **SSH** 推送 —— SSH 认证没有 scope 概念，不受此限制；
>    或干脆在网页上「Add file → Create new file」手建该文件（走登录会话，也不受限）。
>
> 这也是用**分支部署**而不是 Actions 部署的一个实际好处：完全绕开这个坑。
