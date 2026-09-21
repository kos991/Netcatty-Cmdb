package internal

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"czfy-assets/internal/store"
)

func TestIPVisualizationAndAssetAllocationEndpoints(t *testing.T) {
	_, st, mux := newLegacyHandlerTestServer(t)
	if _, err := st.CreateIPSubnet(&store.IPSubnet{Name: "办公网", CIDR: "192.0.2.0/29", Category: "内网"}); err != nil {
		t.Fatal(err)
	}
	assetID, err := st.CreateAsset(&store.Asset{AssetCode: "API-IP-1", DeviceType: "台式电脑", UserName: "张三", Department: "技术处", Room: "301", Status: "在用"}, "测试")
	if err != nil {
		t.Fatal(err)
	}

	rec := doJSON(t, mux, http.MethodGet, "/api/ip_pool/visualization?subnet=办公网&page=1&page_size=20", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("可视化接口失败: %d %s", rec.Code, rec.Body.String())
	}
	var visual struct {
		List  []store.IPEntry `json:"list"`
		Total int             `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &visual); err != nil {
		t.Fatal(err)
	}
	if visual.Total != 6 || len(visual.List) != 6 || visual.List[0].IP != "192.0.2.1" || visual.List[0].ID != 0 {
		t.Fatalf("可视化地址空间不完整: %+v", visual)
	}

	ipID, err := st.CreateIPEntry(&store.IPEntry{Subnet: "办公网", IP: "192.0.2.1", Status: "空闲"})
	if err != nil {
		t.Fatal(err)
	}
	rec = doJSON(t, mux, http.MethodPost, fmt.Sprintf("/api/ip_pool/%d/allocate", ipID), fmt.Sprintf(`{"asset_id":%d,"ip_field":"ip","remark":"接口联动"}`, assetID))
	if rec.Code != http.StatusOK {
		t.Fatalf("关联资产接口失败: %d %s", rec.Code, rec.Body.String())
	}
	asset, _, err := st.GetAsset(assetID)
	if err != nil || asset.IP != "192.0.2.1" {
		t.Fatalf("接口分配后资产未同步: asset=%+v err=%v", asset, err)
	}
}
