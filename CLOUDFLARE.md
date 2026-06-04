# Cloudflare Tunnel 使用说明

## 临时测试地址

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

## 固定地址

如果后面要固定域名，例如：

```text
https://menu.example.com
```

需要在 Cloudflare Zero Trust 里创建正式 Tunnel，并把 Public Hostname 指到：

```text
http://localhost:3000
```

当前项目不需要改代码。
