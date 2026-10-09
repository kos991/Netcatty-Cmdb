package internal

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"czfy-assets/internal/store"
)

func TestTerminalAssetBatchUpdatesOnlySelectedAttributes(t *testing.T) {
	_, st, mux := newLegacyHandlerTestServer(t)
	groupResponse := httptest.NewRecorder()
	mux.ServeHTTP(groupResponse, httptest.NewRequest(http.MethodPost, "/api/cmdb/taxonomy/groups", bytes.NewBufferString(`{"name":"机关终端"}`)))
	if groupResponse.Code != http.StatusOK {
		t.Fatalf("创建分组失败: %d %s", groupResponse.Code, groupResponse.Body.String())
	}
	var group struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(groupResponse.Body.Bytes(), &group); err != nil {
		t.Fatal(err)
	}
	ids := []int64{}
	for i := 0; i < 2; i++ {
		id, err := st.CreateAsset(&store.Asset{AssetCode: fmt.Sprintf("BATCH-%d", i), DeviceType: "云桌面终端", IP: fmt.Sprintf("10.20.30.%d", i+20), TerminalIP: fmt.Sprintf("10.20.31.%d", i+20), DisplaySN: "DISPLAY", OSVersion: "保留版本", Status: "在用"}, "测试")
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	if _, err := st.SyncLegacyToCmdb(); err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf(`{"ids":[%d,%d,%d],"changes":{"group_id":%d,"device_type":"云桌面盒子","os_type":"统信 UOS","status":"闲置"}}`, ids[0], ids[1], ids[0], group.ID)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/assets/batch", bytes.NewBufferString(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("批量属性保存失败: %d %s", rec.Code, rec.Body.String())
	}
	var result struct {
		Affected int `json:"affected"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil || result.Affected != 2 {
		t.Fatalf("重复 ID 应去重: %s err=%v", rec.Body.String(), err)
	}
	for i, id := range ids {
		asset, logs, err := st.GetAsset(id)
		if err != nil {
			t.Fatal(err)
		}
		if asset.DeviceType != "云桌面盒子" || asset.OSType != "统信 UOS" || asset.OSVersion != "保留版本" || asset.Status != "闲置" || asset.GroupID != group.ID || asset.IP != fmt.Sprintf("10.20.30.%d", i+20) || asset.TerminalIP != fmt.Sprintf("10.20.31.%d", i+20) || asset.DisplaySN != "DISPLAY" {
			t.Fatalf("未选字段被覆盖: %+v", asset)
		}
		if len(logs) != 1 || logs[0].LogType != "属性修改" {
			t.Fatalf("批量修改未保留履历: %+v", logs)
		}
		pool, _, err := st.QueryCmdbAssets(store.CmdbAssetQuery{Keyword: asset.AssetCode, Page: 1, PageSize: 20})
		if err != nil || len(pool) != 1 || pool[0].OSType != "统信 UOS" || pool[0].DeviceType != "云桌面盒子" || pool[0].Status != "在库" || pool[0].GroupName != "机关终端" {
			t.Fatalf("镜像属性未同步: %+v err=%v", pool, err)
		}
	}
}

func TestTerminalAssetBatchRejectsOtherProjectAssets(t *testing.T) {
	s, st, mux := newLegacyHandlerTestServer(t)
	_, scopeA := createHTTPTestProject(t, s, "batch-a")
	_, scopeB := createHTTPTestProject(t, s, "batch-b")
	idA, err := st.CreateAssetForProject(scopeA, &store.Asset{AssetCode: "A", OSType: "Windows"}, "测试")
	if err != nil {
		t.Fatal(err)
	}
	idB, err := st.CreateAssetForProject(scopeB, &store.Asset{AssetCode: "B", OSType: "Windows"}, "测试")
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	body := fmt.Sprintf(`{"ids":[%d,%d],"changes":{"os_type":"统信 UOS"}}`, idA, idB)
	mux.ServeHTTP(rec, projectRequest(http.MethodPost, "/api/assets/batch", []byte(body), scopeA.ProjectID))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("跨项目批量修改应拒绝: %d %s", rec.Code, rec.Body.String())
	}
	for _, item := range []struct {
		id    int64
		scope store.ProjectScope
	}{{idA, scopeA}, {idB, scopeB}} {
		asset, logs, err := st.GetAssetForProject(item.scope, item.id)
		if err != nil || asset.OSType != "Windows" || len(logs) != 0 {
			t.Fatalf("拒绝后仍修改了资产: %+v logs=%+v err=%v", asset, logs, err)
		}
	}
}

func TestTerminalAssetBatchRejectsInvalidChanges(t *testing.T) {
	for _, changes := range []string{`{}`, `{"group_id":999999}`, `{"group_id":-1}`, `{"ip":"10.20.30.55"}`} {
		t.Run(changes, func(t *testing.T) {
			_, st, mux := newLegacyHandlerTestServer(t)
			id, err := st.CreateAsset(&store.Asset{AssetCode: "UNCHANGED", OSType: "Windows", IP: "10.20.30.50"}, "测试")
			if err != nil {
				t.Fatal(err)
			}
			rec := httptest.NewRecorder()
			body := fmt.Sprintf(`{"ids":[%d],"changes":%s}`, id, changes)
			mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/assets/batch", bytes.NewBufferString(body)))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("非法批量属性应拒绝: %d %s", rec.Code, rec.Body.String())
			}
			asset, logs, err := st.GetAsset(id)
			if err != nil || asset.GroupID != 0 || asset.IP != "10.20.30.50" || len(logs) != 0 {
				t.Fatalf("拒绝后应保持原状: %+v logs=%+v err=%v", asset, logs, err)
			}
		})
	}
}

func TestTerminalAssetBatchRollsBackWhenAnyAssetIsMissing(t *testing.T) {
	_, st, mux := newLegacyHandlerTestServer(t)
	id, err := st.CreateAsset(&store.Asset{AssetCode: "ATOMIC", DeviceType: "台式电脑", OSType: "Windows", Status: "在用"}, "测试")
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	body := fmt.Sprintf(`{"ids":[%d,999999],"changes":{"os_type":"统信 UOS"}}`, id)
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/assets/batch", bytes.NewBufferString(body)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("批量失败应返回 400: %d %s", rec.Code, rec.Body.String())
	}
	asset, logs, err := st.GetAsset(id)
	if err != nil || asset.OSType != "Windows" || len(logs) != 0 {
		t.Fatalf("失败后出现部分保存: %+v logs=%+v err=%v", asset, logs, err)
	}
}
