package store

import (
	"strings"
	"testing"
)

func TestIPSubnetSegmentsScopedValidationAndStatistics(t *testing.T) {
	s := newCmdbTestStore(t)
	scopeA, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	projectB, err := s.CreateCmdbProject(&CmdbProject{Code: "ip-segments-other", Name: "其他地址池项目"})
	if err != nil {
		t.Fatal(err)
	}
	scopeB := ProjectScope{ProjectID: projectB.ID}
	pool := &IPSubnet{Name: "楼层地址池", CIDR: "192.0.2.0/24", Segments: []IPSubnetSegment{
		{Name: "速载", Floor: "3楼", StartIP: "192.0.2.2", EndIP: "192.0.2.40"},
		{Name: "刑一", Floor: "4楼", StartIP: "192.0.2.41", EndIP: "192.0.2.60"},
	}}
	id, err := s.CreateIPSubnetForProject(scopeA, pool)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateIPSubnetForProject(scopeB, &IPSubnet{Name: pool.Name, CIDR: pool.CIDR}); err != nil {
		t.Fatal(err)
	}
	first, err := s.GetIPSubnetForProject(scopeA, id)
	if err != nil || len(first.Segments) != 2 || first.Segments[0].Count != 39 || first.Segments[1].Count != 20 {
		t.Fatalf("分段保存回读错误: %+v %v", first, err)
	}
	other, err := s.ListIPSubnetsForProject(scopeB)
	if err != nil || len(other) != 1 || len(other[0].Segments) != 0 {
		t.Fatalf("跨项目分段泄漏: %+v %v", other, err)
	}
	if _, err := s.CreateIPEntryForProject(scopeA, &IPEntry{Subnet: pool.Name, IP: "192.0.2.2", Status: "保留"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateIPEntryForProject(scopeA, &IPEntry{Subnet: pool.Name, IP: "192.0.2.41", Status: "在用", Account: "测试"}); err != nil {
		t.Fatal(err)
	}
	updated, err := s.GetIPSubnetForProject(scopeA, id)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Segments[0].Reserved != 1 || updated.Segments[0].Free != 38 || updated.Segments[1].Used != 1 || updated.Segments[1].Free != 19 {
		t.Fatalf("分段统计错误: %+v", updated.Segments)
	}
	segmentID := updated.Segments[0].ID
	grid, total, err := s.VisualizeIPSegmentForProject(scopeA, pool.Name, segmentID, 1, 2)
	if err != nil || total != 39 || len(grid) != 2 || grid[0].IP != "192.0.2.2" || grid[0].Status != "保留" || grid[1].IP != "192.0.2.3" || grid[1].SegmentName != "速载" {
		t.Fatalf("分段方格分页错误: total=%d grid=%+v err=%v", total, grid, err)
	}
	entries, count, err := s.QueryIPEntriesForProject(scopeA, IPEntryQuery{Subnet: pool.Name, SegmentID: segmentID, Page: 1, PageSize: 1})
	if err != nil || count != 1 || len(entries) != 1 || entries[0].SegmentName != "速载" {
		t.Fatalf("分段列表错误: count=%d entries=%+v err=%v", count, entries, err)
	}
	exported, err := s.AllIPEntriesForProject(scopeA, IPEntryQuery{Subnet: pool.Name, SegmentID: segmentID})
	if err != nil || len(exported) != 1 || exported[0].IP != "192.0.2.2" {
		t.Fatalf("分段导出查询错误: %+v %v", exported, err)
	}
	if err := s.ValidateIPEntrySegmentsForProject(scopeA, []IPEntry{{Subnet: pool.Name, IP: "192.0.2.2", SegmentName: "速载", SegmentFloor: "3楼"}}); err != nil {
		t.Fatalf("新格式导入映射失败: %v", err)
	}
	if err := s.ValidateIPEntrySegmentsForProject(scopeA, []IPEntry{{Subnet: pool.Name, IP: "192.0.2.41", SegmentName: "速载", SegmentFloor: "3楼"}}); err == nil {
		t.Fatal("导入分段与 IP 地址不符应拒绝")
	}
	if err := s.ValidateIPEntrySegmentsForProject(scopeA, []IPEntry{{Subnet: pool.Name, IP: "192.0.2.41"}}); err != nil {
		t.Fatalf("旧格式导入不应依赖分段列: %v", err)
	}
	for _, tc := range []struct {
		name     string
		segments []IPSubnetSegment
		reason   string
	}{
		{"overlap", []IPSubnetSegment{{Name: "甲", StartIP: "192.0.2.2", EndIP: "192.0.2.15"}, {Name: "乙", StartIP: "192.0.2.15", EndIP: "192.0.2.20"}}, "重叠"},
		{"outside", []IPSubnetSegment{{Name: "越界", StartIP: "192.0.2.30", EndIP: "192.0.3.40"}}, "CIDR"},
		{"reverse", []IPSubnetSegment{{Name: "逆序", StartIP: "192.0.2.30", EndIP: "192.0.2.2"}}, "不能大于"},
		{"count", []IPSubnetSegment{{Name: "数量", StartIP: "192.0.2.30", EndIP: "192.0.2.32", Count: 9}}, "数量"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			candidate := *updated
			candidate.Segments = tc.segments
			if err := s.UpdateIPSubnetForProject(scopeA, &candidate); err == nil || !strings.Contains(err.Error(), tc.reason) {
				t.Fatalf("非法分段应拒绝: %v", err)
			}
			stored, err := s.GetIPSubnetForProject(scopeA, id)
			if err != nil || len(stored.Segments) != 2 || stored.Segments[0].ID != segmentID {
				t.Fatalf("失败后数据变化: %+v %v", stored, err)
			}
		})
	}
	updated.Segments = updated.Segments[1:]
	if err := s.UpdateIPSubnetForProject(scopeA, updated); err != nil {
		t.Fatal(err)
	}
	if _, err := s.IPSubnetSegmentForProject(scopeA, pool.Name, segmentID); err == nil {
		t.Fatal("删除的分段仍可查询")
	}
}
