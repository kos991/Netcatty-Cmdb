package internal

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"czfy-assets/internal/store"
)

func TestCmdbNetcattyLinkAPIRejectsSecretFields(t *testing.T) {
	s := newCmdbTestServer(t)
	scope, _ := s.Store.DefaultProjectScope()
	assetID, err := s.Store.CreateCmdbAssetManualForProject(scope, &store.CmdbAsset{Name: "API 主机关联"})
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)

	body := fmt.Sprintf(`{"asset_type":"infrastructure","asset_id":%d,"host_id":"host-1","host_name":"主机一","password":"不能进入 Cmdb"}`, assetID)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/cmdb/netcatty-links", strings.NewReader(body)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("秘密字段应被拒绝，状态码=%d 响应=%s", rec.Code, rec.Body.String())
	}
}
