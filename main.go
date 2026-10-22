package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"

	"czfy-assets/internal"
	"czfy-assets/internal/store"
)

// version 由构建注入，未注入时回退为开发版本。
var version = "dev"

func newHTTPHandler(srv *internal.Server, _ bool) (http.Handler, error) {
	mux := http.NewServeMux()
	srv.RegisterRoutes(mux)
	return mux, nil
}

func openApplicationStore(dbPath string) (*store.Store, error) {
	st, err := store.Open(dbPath)
	if err != nil {
		return nil, fmt.Errorf("Cmdb 数据库初始化失败: %w", err)
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
	// 保留启动参数兼容已安装的 Netcatty 服务桥；服务始终仅提供 API。
	flag.Bool("no-browser", true, "兼容参数：不打开浏览器")
	apiOnly := flag.Bool("api-only", true, "兼容参数：服务始终仅提供 API")
	flag.Parse()

	st, err := openApplicationStore(*dbPath)
	if err != nil {
		log.Fatal(err)
	}
	defer st.Close()

	srv := &internal.Server{Store: st, Version: version}
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
	log.Printf("  Netcatty Cmdb API 服务已启动")
	log.Printf("  本地服务地址: %s", url)
	log.Printf("=====================================================")

	if err := http.Serve(listener, handler); err != nil {
		log.Fatalf("服务运行退出: %v", err)
	}
}
