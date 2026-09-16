package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os/exec"
	"runtime"

	"czfy-assets/internal"
	"czfy-assets/internal/store"
)

//go:embed seed/seed_v2.json
var seedJSON []byte

//go:embed web/dist
var webFS embed.FS

func main() {
	port := flag.Int("port", 0, "监听端口（0 表示自动选择空闲端口）")
	dbPath := flag.String("db", "assets.db", "SQLite 数据库文件路径")
	noBrowser := flag.Bool("no-browser", false, "启动时不自动打开浏览器")
	flag.Parse()

	st, err := store.Open(*dbPath)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	defer st.Close()

	seeded, err := st.IsSeededV2()
	if err != nil {
		log.Fatalf("检查导入状态失败: %v", err)
	}

	var seed store.SeedV2
	if err := json.Unmarshal(seedJSON, &seed); err != nil {
		log.Fatalf("解析初始化种子数据失败: %v", err)
	}

	if !seeded {
		log.Println("检测到全新数据库，正在导入初始化资产台账与运维履历...")
		if err := st.ImportSeedV2(&seed); err != nil {
			log.Fatalf("导入初始化种子数据失败: %v", err)
		}
		if err := st.MarkSeededV2(); err != nil {
			log.Fatalf("标记初始化状态失败: %v", err)
		}
		log.Printf("数据导入完成: %d 条终端资产, %d 条履历流水, %d 条IP规划, %d 台物理服务器\n", len(seed.Assets), len(seed.AssetLogs), len(seed.IPPool), len(seed.Servers))
	} else {
		// 若历史数据库已存在，自动增量检查并补入物理服务器与系统应用
		if err := st.EnsureServersSeeded(&seed); err != nil {
			log.Printf("增量检查服务器基础数据异常: %v", err)
		}
	}

	// 规范化历史迁移遗留的复合 IP 值（幂等，可重复执行）
	if n, err := st.NormalizeIPPoolIPs(); err != nil {
		log.Printf("IP 池地址规范化异常: %v", err)
	} else if n > 0 {
		log.Printf("已规范化 %d 条 IP 记录（复合地址 → 纯地址，盒子地址保留在备注）", n)
	}

	// 为已有 IP 数据补建网段定义（幂等），使网段可在「网段管理」中维护
	if n, err := st.SeedIPSubnetsFromPool(); err != nil {
		log.Printf("补建网段定义异常: %v", err)
	} else if n > 0 {
		log.Printf("已补建 %d 个网段定义", n)
	}

	// 补齐早期映射遗漏的 CMDB「负责人」（幂等）
	if n, err := st.BackfillLegacyAssetOwner(); err != nil {
		log.Printf("补齐 CMDB 负责人异常: %v", err)
	} else if n > 0 {
		log.Printf("已补齐 %d 条 CMDB 记录的负责人", n)
	}

	srv := &internal.Server{Store: st}
	mux := http.NewServeMux()
	srv.RegisterRoutes(mux)

	// 前端静态页面
	dist, err := fs.Sub(webFS, "web/dist")
	if err != nil {
		log.Fatalf("加载前端资源失败: %v", err)
	}
	fileServer := http.FileServer(http.FS(dist))
	mux.Handle("/", fileServer)

	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		log.Fatalf("监听端口失败: %v", err)
	}
	addr := listener.Addr().String()
	url := fmt.Sprintf("http://%s", addr)
	log.Printf("=====================================================")
	log.Printf("  常州中院云桌面资产与全景服务器管理系统已启动")
	log.Printf("  访问地址: %s", url)
	log.Printf("=====================================================")

	if !*noBrowser {
		go func() {
			switch runtime.GOOS {
			case "windows":
				_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
			case "darwin":
				_ = exec.Command("open", url).Start()
			default:
				_ = exec.Command("xdg-open", url).Start()
			}
		}()
	}

	if err := http.Serve(listener, mux); err != nil {
		log.Fatalf("服务运行退出: %v", err)
	}
}
