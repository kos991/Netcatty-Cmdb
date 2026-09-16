package internal

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"czfy-assets/internal/store"
)

func TestPersonAndCustomFieldAPIs(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "server_person_cf_test.db"))
	if err != nil {
		t.Fatalf("failed to open test store: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	s := &Server{Store: st}
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)

	// 1. 创建人员 A 与 人员 B
	bodyA := `{"name":"张三","department":"审判管理处","org_name":"常州中院","title":"法官助理","phone":"13800000001"}`
	reqA := httptest.NewRequest(http.MethodPost, "/api/cmdb/persons", bytes.NewBufferString(bodyA))
	reqA.Header.Set("Content-Type", "application/json")
	wA := httptest.NewRecorder()
	mux.ServeHTTP(wA, reqA)
	if wA.Code != http.StatusOK {
		t.Fatalf("create person A failed, code: %d, body: %s", wA.Code, wA.Body.String())
	}
	var resA map[string]interface{}
	_ = json.Unmarshal(wA.Body.Bytes(), &resA)
	personAID := int64(resA["id"].(float64))

	bodyB := `{"name":"李四","department":"信息技术科","org_name":"常州中院","title":"网络管理员","phone":"13800000002"}`
	reqB := httptest.NewRequest(http.MethodPost, "/api/cmdb/persons", bytes.NewBufferString(bodyB))
	reqB.Header.Set("Content-Type", "application/json")
	wB := httptest.NewRecorder()
	mux.ServeHTTP(wB, reqB)
	if wB.Code != http.StatusOK {
		t.Fatalf("create person B failed, code: %d", wB.Code)
	}
	var resB map[string]interface{}
	_ = json.Unmarshal(wB.Body.Bytes(), &resB)
	personBID := int64(resB["id"].(float64))

	// 2. 查询人员列表
	reqList := httptest.NewRequest(http.MethodGet, "/api/cmdb/persons", nil)
	wList := httptest.NewRecorder()
	mux.ServeHTTP(wList, reqList)
	if wList.Code != http.StatusOK {
		t.Fatalf("list persons failed: %d", wList.Code)
	}

	// 3. 创建资产并关联张三
	assetReq := fmt.Sprintf(`{"name":"审判庭终端PC-01","asset_class":"desktop","department":"审判管理处","owner":"张三","owner_id":%d,"manage_ip":"192.168.10.25","status":"在用"}`, personAID)
	reqAsset := httptest.NewRequest(http.MethodPost, "/api/cmdb/assets", bytes.NewBufferString(assetReq))
	reqAsset.Header.Set("Content-Type", "application/json")
	wAsset := httptest.NewRecorder()
	mux.ServeHTTP(wAsset, reqAsset)
	if wAsset.Code != http.StatusOK {
		t.Fatalf("create asset failed: %d, body: %s", wAsset.Code, wAsset.Body.String())
	}

	// 4. 穿透获取张三名下资产
	reqPersonAssets := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/cmdb/persons/%d/assets", personAID), nil)
	wPA := httptest.NewRecorder()
	mux.ServeHTTP(wPA, reqPersonAssets)
	if wPA.Code != http.StatusOK {
		t.Fatalf("get person assets failed: %d", wPA.Code)
	}

	// 5. 资产一键交接（从张三转到李四）
	transferBody := fmt.Sprintf(`{"from_person_id":%d,"to_person_id":%d,"operator":"admin","remark":"工作调岗交接"}`, personAID, personBID)
	reqTransfer := httptest.NewRequest(http.MethodPost, "/api/cmdb/persons/transfer", bytes.NewBufferString(transferBody))
	reqTransfer.Header.Set("Content-Type", "application/json")
	wTransfer := httptest.NewRecorder()
	mux.ServeHTTP(wTransfer, reqTransfer)
	if wTransfer.Code != http.StatusOK {
		t.Fatalf("transfer failed: %d, body: %s", wTransfer.Code, wTransfer.Body.String())
	}

	// 6. 自定义字段 CRUD
	cfBody := `{"field_key":"security_level","field_name":"安全等保级别","field_type":"select","options":["等保二级","等保三级"],"asset_class":"all","required":1}`
	reqCF := httptest.NewRequest(http.MethodPost, "/api/cmdb/custom-fields", bytes.NewBufferString(cfBody))
	reqCF.Header.Set("Content-Type", "application/json")
	wCF := httptest.NewRecorder()
	mux.ServeHTTP(wCF, reqCF)
	if wCF.Code != http.StatusOK {
		t.Fatalf("create custom field failed: %d, body: %s", wCF.Code, wCF.Body.String())
	}

	reqListCF := httptest.NewRequest(http.MethodGet, "/api/cmdb/custom-fields", nil)
	wListCF := httptest.NewRecorder()
	mux.ServeHTTP(wListCF, reqListCF)
	if wListCF.Code != http.StatusOK {
		t.Fatalf("list custom fields failed: %d", wListCF.Code)
	}
}
