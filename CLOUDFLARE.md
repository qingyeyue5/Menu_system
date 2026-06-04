# Cloudflare Tunnel 使用说明

## 临时测试地址

先确认已经安装系统版 Cloudflare Tunnel：

```powershell
winget install --id Cloudflare.cloudflared
```

直接双击：

```text
start-all-quick-tunnel.cmd
```

它会打开两个窗口：

- `Menu System`：本地菜单系统。
- `Cloudflare Quick Tunnel`：Cloudflare 临时公网地址。

在 `Cloudflare Quick Tunnel` 窗口里找到类似下面的地址：

```text
https://xxxx.trycloudflare.com
```

把这个地址发给对方。两个人都访问同一个地址。

## 注意

- 两个窗口都不能关。
- 电脑不能关机或断网。
- 临时地址可能每次启动都会变。
- 第一次启动菜单系统时，窗口里会显示初始口令；登录后请到“安全”里修改。
- 如果提示找不到 `cloudflared`，请关掉窗口重开；仍不行就重启一次 Windows，让系统 PATH 刷新。

## 固定地址

如果后面要固定域名，例如：

```text
https://menu.example.com
```

前提：这个域名已经添加到 Cloudflare。

第一次设置时双击：

```text
setup-fixed-tunnel.cmd
```

按窗口提示输入固定网址，例如：

```text
menu.example.com
```

设置成功后，以后每天直接双击：

```text
start-all-fixed-tunnel.cmd
```

固定网址会指到本机服务：

```text
http://localhost:3000
```

当前项目不需要改代码。

如果你没有自己的域名，`trycloudflare.com` 临时地址不能固定，只能每次复制新的临时地址。
