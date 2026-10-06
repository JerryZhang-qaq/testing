# 第一版验证记录

在云端 Linux、Node.js 24.19.0、Electron 44.5.1 下验证。Electron 界面测试使用虚拟显示，受限容器中仅测试启用 `LANREAD_TEST_NO_SANDBOX=1`。Windows 未在本次云端会话中运行。

| 检查 | 结果 |
| --- | --- |
| 冻结锁文件安装 `npm ci`，包含 Electron 安装与官方 checksum 校验 | 通过 |
| `npm run build`（TypeScript、Vite、第三方许可清单） | 通过 |
| `npm test` | 14 通过，0 失败、跳过或取消 |
| `npm run test:e2e` | 3 通过，0 失败或跳过 |
| `npm audit --omit=dev` | 0 已知运行时依赖漏洞 |
| 全依赖 `npm audit` | 8 个中等等级报告，来自打包工具链的 `sprintf-js` 及其依赖链；未使用强制降级修复 |
| Windows 安装包构建、安装和实际系统字体 | 未执行；提供 Windows Actions 工作流 |

桌面测试实际执行：

- 导入 EPUB 2/3，显示封面、作者，按系列堆叠并按册序展开。
- 加载实际 XHTML 正文及样式，上一页 / 下一页、EPUB 3 目录和 EPUB 2 NCX 目录跳转。
- 同一位置创建两根书签，分别编辑标题和备注，验证互不覆盖。
- 切换夜读背景和字体字号，验证正文实际计算样式。
- 关闭 Electron 并重新启动，恢复章节位置、字体设置和独立书签备注，再删除单根书签。
- 手动编辑系列、作者搜索、损坏文件与有效文件混合导入、重复导入去重、移出书库且保留原文件。
- 嵌入书籍的脚本不执行，远程图片不能加载。

测试 EPUB 为代码生成的原创样本，并非各种出版商的完整兼容性语料库。固定版式、竖排、复杂公式、字体混淆和媒体 EPUB 尚未逐类验证，不宣称兼容所有 EPUB。

## 界面截图

截图来自真实运行的应用，书籍为自动生成的原创演示样本，不包含用户数据，应用不会预装这些样本。

![书库与系列堆叠](screenshots/library.png)

![系列展开](screenshots/series.png)

![阅读与独立书签备注](screenshots/reading.png)
