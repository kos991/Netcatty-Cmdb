package internal

import (
	"net/http/httptest"
	"testing"
)

func TestCmdbQueryFromRequestKeepsCombinedTypeAndUnassignedGroup(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/cmdb/assets?category_id=7&device_type=switch&group_id=-1", nil)
	query := cmdbQueryFromRequest(req, 2, 50)
	if query.CategoryID != 7 || query.DeviceType != "switch" || query.GroupID != -1 {
		t.Fatalf("基础设施筛选参数解析错误: %+v", query)
	}
	if query.Page != 2 || query.PageSize != 50 {
		t.Fatalf("分页参数不应被筛选解析破坏: %+v", query)
	}
}
