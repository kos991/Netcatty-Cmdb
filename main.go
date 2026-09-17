package main

import (
	"embed"
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

//go:embed web/dist
var webFS embed.FS

func newHTTPHandler(srv *internal.Server, apiOnly bool) (http.Handler, error) {
	mux := http.NewServeMux()
	srv.RegisterRoutes(mux)
	if apiOnly {
		return mux, nil
	}
	dist, err := fs.Sub(webFS, "web/dist")
	if err != nil {
		return nil, fmt.Errorf("加载前端资源失败: %w", err)
	}
	mux.Handle("/", http.FileServer(http.FS(dist)))
	return mux, nil
}

func openApplicationStore(dbPath string) (*store.Store, error) {
	st, err := store.Open(dbPath)
	if err != nil {
		return nil, fmt.Errorf("打开数据库失败: %w", err)
	}
	if _, err := st.SeedIPSubnetsFromPool(); err != nil {
		st.Close()
		return nil, fmt.Errorf("初始化网段定义失败: %w", err)
	}
	return st, nil
}

func main() {
	port := flag.Int("port", 0, "监听端口（0 表示自动选择空闲端口）")
	dbPath := flag.String("db", "assets.db", "SQLite 数据库文件路径")
	noBrowser := flag.Bool("no-browser", false, "启动时不自动打开浏览器")
	apiOnly := flag.Bool("api-only", false, "仅启动 API 服务，不提供前端页面")
	flag.Parse()

	st, err := openApplicationStore(*dbPath)
	if err != nil {
		log.Fatal(err)
	}
	defer st.Close()

	srv := &internal.Server{Store: st}
	handler, err := newHTTPHandler(srv, *apiOnly)
	if err != nil {
		log.Fatalf("创建 HTTP 服务失败: %v", err)
	}

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

	if !*noBrowser && !*apiOnly {
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

	if err := http.Serve(listener, handler); err != nil {
		log.Fatalf("服务运行退出: %v", err)
	}
}
