# 私宴点菜系统

双端网页点菜系统：

- 宝宝端：菜单设置、接单、制作/配送、完成订单、查看历史。
- 宝贝端：选菜、预约/备注、下单、查看订单状态和历史。

## 启动

固定网址已经配置为：

```text
https://menu.qingyeyue.xyz
```

每天使用时双击：

```text
start-all-fixed-tunnel.cmd
```

它会打开两个窗口：

- `Menu System`：本地点菜系统。
- `Cloudflare Fixed Tunnel`：固定公网地址隧道。

两个窗口都要保持打开。电脑关机、断网或窗口关闭后，外面就访问不了。

本机也可以打开：

```text
http://localhost:3000
```

## 密码

系统启动时会在 `Menu System` 窗口里显示：

- 宝宝密码
- 宝贝密码

密码明文只保存在本机：

```text
data/local-passwords.json
```

这个文件不会上传 GitHub。进入宝宝端后，可以在“安全”里修改两边密码；修改后，下次启动窗口会显示新密码。

如果忘记密码，不要删除 `data/store.json`。直接双击：

```text
reset-passwords-only.cmd
```

它只会重置宝宝/宝贝密码并清空设备绑定，菜单、菜品、价格、图片和订单都会保留。

## 性能架构

菜品图片不会再写进 `data/store.json`，会保存为独立文件：

```text
public/uploads/
```

菜单数据只保存图片地址，这样页面加载和订单处理会更快。`public/uploads/` 已加入 `.gitignore`，不会上传 GitHub。

## 本机数据

这些文件只保存在本机，不上传 GitHub：

```text
data/store.json
data/local-passwords.json
public/uploads/
cloudflared-fixed.yml
```

如果删除 `data/store.json`，菜单、订单、设备绑定都会清空。
