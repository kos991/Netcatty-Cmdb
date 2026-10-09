package internal

import (
	"net/http/httptest"
	"testing"

	"czfy-assets/internal/store"
)

func TestCmdbQueryFromRequestKeepsCombinedTypeUnassignedGroupAndLocation(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/cmdb/assets?category_id=7&device_type=switch&group_id=-1&location=%E4%B8%9C%E5%8C%BA%E6%9C%BA%E6%88%BF", nil)
	query := cmdbQueryFromRequest(req, 2, 50)
	if query.CategoryID != 7 || query.DeviceType != "switch" || query.GroupID != -1 || query.Location != "东区机房" {
		t.Fatalf("基础设施筛选参数解析错误: %+v", query)
	}
	if query.Page != 2 || query.PageSize != 50 {
		t.Fatalf("分页参数不应被筛选解析破坏: %+v", query)
	}
}

func TestCmdbExportLocationColumnUsesActualLocation(t *testing.T) {
	asset := store.CmdbAsset{Room: "东区机房 301", CabinetName: "A01", StartU: 10, HeightU: 2}
	for _, column := range cmdbExportColumns {
		if column.Title == "位置标识" {
			if got := column.Get(asset); got != "东区机房 301 · A01 · 10U–11U" {
				t.Fatalf("导出位置标识错误: %q", got)
			}
			return
		}
	}
	t.Fatal("导出列缺少位置标识")
}
