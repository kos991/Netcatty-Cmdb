package internal

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"czfy-assets/internal/store"
)

func TestRackMigrationHTTPApprovalBackupRollbackAndProjectIsolation(t *testing.T) {
	s := newCmdbTestServer(t)
	_, scopeA := createHTTPTestProject(t, s, "rack-http-a")
	_, scopeB := createHTTPTestProject(t, s, "rack-http-b")
	locationID, err := s.Store.CreateConfigItem(scopeA, store.ConfigKindLocations, &store.ConfigItem{Name: "甲机房（1－1机柜）", RackUnits: 47})
	if err != nil {
		t.Fatal(err)
	}
	assetID, err := s.Store.CreateCmdbAssetManualForProject(scopeA, &store.CmdbAsset{Name: "服务器", DataCenter: "甲机房", CabinetName: "1-1机柜"})
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)
	request := func(method, path string, body any, scope store.ProjectScope) *httptest.ResponseRecorder {
		t.Helper()
		var encoded []byte
		if body != nil {
			var err error
			encoded, err = json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
		}
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, projectRequest(method, path, encoded, scope.ProjectID))
		return rec
	}
	previewResponse := request(http.MethodGet, "/api/cmdb/rack-migration", nil, scopeA)
	var preview store.RackMigrationPreview
	if previewResponse.Code != http.StatusOK || json.Unmarshal(previewResponse.Body.Bytes(), &preview) != nil || preview.Total != 1 || len(preview.Locations) != 1 || preview.Token == "" {
		t.Fatalf("位置目录单独迁移也应可预览审批: %d %s", previewResponse.Code, previewResponse.Body.String())
	}
	if rec := request(http.MethodPost, "/api/cmdb/rack-migration", map[string]any{"token": preview.Token}, scopeB); rec.Code != http.StatusConflict {
		t.Fatalf("跨项目审批必须409: %d %s", rec.Code, rec.Body.String())
	}
	if rec := request(http.MethodPost, "/api/cmdb/rack-migration", map[string]any{}, scopeA); rec.Code != http.StatusConflict {
		t.Fatalf("缺少审批必须409: %d %s", rec.Code, rec.Body.String())
	}
	remark := "预览后的新修改"
	if _, err := s.Store.ApplyCmdbAssetChangesForProject(scopeA, []int64{assetID}, store.CmdbAssetChanges{Remark: &remark}); err != nil {
		t.Fatal(err)
	}
	if rec := request(http.MethodPost, "/api/cmdb/rack-migration", map[string]any{"token": preview.Token}, scopeA); rec.Code != http.StatusConflict {
		t.Fatalf("过期审批必须409: %d %s", rec.Code, rec.Body.String())
	}
	previewResponse = request(http.MethodGet, "/api/cmdb/rack-migration", nil, scopeA)
	if err := json.Unmarshal(previewResponse.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	applyResponse := request(http.MethodPost, "/api/cmdb/rack-migration", map[string]any{"token": preview.Token}, scopeA)
	var result store.RackMigrationResult
	if applyResponse.Code != http.StatusOK || json.Unmarshal(applyResponse.Body.Bytes(), &result) != nil || result.Updated != 1 || result.BackupPath == "" {
		t.Fatalf("确认须返回真实备份与数量: %d %s", applyResponse.Code, applyResponse.Body.String())
	}
	locations, err := s.Store.ListConfigItems(scopeA, store.ConfigKindLocations)
	if err != nil || len(locations) != 1 || locations[0].ID != locationID || locations[0].Name != "甲机房 (1-1机柜)" || locations[0].RackUnits != 47 {
		t.Fatalf("目录迁移丢失身份或47U: %+v %v", locations, err)
	}
	if rec := request(http.MethodPost, "/api/cmdb/rack-migration/rollback", nil, scopeB); rec.Code != http.StatusConflict {
		t.Fatalf("其他项目不能回滚: %d %s", rec.Code, rec.Body.String())
	}
	rollbackResponse := request(http.MethodPost, "/api/cmdb/rack-migration/rollback", nil, scopeA)
	var rolledBack struct {
		Updated int `json:"updated"`
	}
	if rollbackResponse.Code != http.StatusOK || json.Unmarshal(rollbackResponse.Body.Bytes(), &rolledBack) != nil || rolledBack.Updated != 1 {
		t.Fatalf("回滚数量合同错误: %d %s", rollbackResponse.Code, rollbackResponse.Body.String())
	}
	locations, err = s.Store.ListConfigItems(scopeA, store.ConfigKindLocations)
	if err != nil || locations[0].Name != "甲机房（1－1机柜）" || locations[0].RackUnits != 47 {
		t.Fatalf("回滚须恢复旧目录: %+v %v", locations, err)
	}
}
