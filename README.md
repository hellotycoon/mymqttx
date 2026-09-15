# MyMQTTX

一个面向 Agent 联调的轻量级 MQTT 测试台。界面参考 MQTTX，以白色为主、绿色为强调色，集成当前 Agent 工程常用的发布 Payload 和输出订阅 Topic。

## 启动

```bash
cd ~/mymqttx
./run.sh
```

应用会在本机启动 `http://127.0.0.1:8765` 并自动打开默认浏览器。若不希望自动打开浏览器：

```bash
./run.sh --no-browser
```

如果 8765 端口已被占用，可指定其他端口：

```bash
./run.sh --port 18765
```

按终端中的 `Ctrl+C` 退出。退出时会主动断开 MQTT Broker。

## 使用说明

- 启动后默认不连接 Broker。点击右上角“连接 Broker”，默认地址为 `127.0.0.1:1883`。
- 左侧是订阅窗口。新增订阅会立即保存；右键 Topic 可以编辑、暂停或删除。连接后，已启用 Topic 会高亮。
- 底部是发布窗口。发布卡片支持鼠标拖动和滚轮横向浏览；右键可编辑、复制或删除。
- Payload 只能发送合法 JSON。发送前，浏览器和本地服务都会各校验一次；错误会显示行列提示。
- “发送频率”默认为单次。选择周期后，点击“开始循环”；不同 Topic 可以同时循环发送。
- `Ctrl+Enter` 发送，`Ctrl+S` 保存当前发布配置。
- 消息窗口最多保留最近 1000 条数据，页面最多渲染 600 条，避免长时间测试后卡顿。

## 配置

所有运行配置保存在：

```text
~/.Config/mymqttx/config.json
```

配置文件权限为 `0600`。保存内容包括 Broker 参数、发布 Topic/Payload/QoS/Retain/频率，以及订阅 Topic/QoS/启用状态。软件始终保持“手动连接”，不会因保存过 Broker 参数而在下次启动时自动连接。

## 技术说明

- 运行环境：Ubuntu + Python 3.10 或更高版本 + 现代浏览器。
- 无第三方 Python 依赖，不需要 Electron、Node.js、Tk 或 pip 安装。
- MQTT：3.1.1/TCP，支持 QoS 0/1/2、Retain、Clean Session、用户名密码认证和通配符订阅。
- Web UI 仅监听本机回环地址，不对局域网开放。

## 默认数据来源

发布模板来自工作目录中的以下脚本：

- `pub_ads_toc_request.sh`
- `pub_missioncmd_request.sh`
- `pub_localization_odom.sh` / `set_pose.sh`
- `pub_function_control_state.sh`
- `pub_function_control_battery.sh`
- `pub_support_fun_state.sh`
- `pub_light_rain_sensor.sh`
- `pub_localplan_feedback.sh`
- `pub_global_specialarea_request.sh`
- `set-fcw-result.sh`

默认订阅列表来自 `agent.yaml` 中 `pub agent` 的 MQTT 输出规则。
