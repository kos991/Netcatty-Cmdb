package store

import "testing"

func TestCmdbTaxonomyCRUDAllKinds(t *testing.T) {
	s := newCmdbTestStore(t)

	for _, kind := range []string{"orgs", "groups", "categories"} {
		id, err := s.CreateCmdbTaxonomy(kind, "一级节点", 0, 1)
		if err != nil {
			t.Fatalf("[%s] 新增失败: %v", kind, err)
		}
		child, err := s.CreateCmdbTaxonomy(kind, "二级节点", id, 1)
		if err != nil {
			t.Fatalf("[%s] 新增子节点失败: %v", kind, err)
		}

		list, err := s.ListCmdbTaxonomy(kind)
		if err != nil {
			t.Fatalf("[%s] 查询失败: %v", kind, err)
		}
		if len(list) != 2 {
			t.Fatalf("[%s] 应有 2 个节点，实际 %d", kind, len(list))
		}

		// 重命名
		if err := s.UpdateCmdbTaxonomy(kind, id, "改名后", 0, 5); err != nil {
			t.Fatalf("[%s] 更新失败: %v", kind, err)
		}
		list, _ = s.ListCmdbTaxonomy(kind)
		found := false
		for _, n := range list {
			if n.ID == id {
				found = true
				if n.Name != "改名后" || n.SortOrder != 5 {
					t.Fatalf("[%s] 更新未生效: %+v", kind, n)
				}
			}
		}
		if !found {
			t.Fatalf("[%s] 更新后找不到节点 %d", kind, id)
		}

		// 有子节点时必须拒绝删除
		if err := s.DeleteCmdbTaxonomy(kind, id); err == nil {
			t.Fatalf("[%s] 有子节点时删除必须被拒绝", kind)
		}
		// 先删子节点，再删父节点
		if err := s.DeleteCmdbTaxonomy(kind, child); err != nil {
			t.Fatalf("[%s] 删除子节点失败: %v", kind, err)
		}
		if err := s.DeleteCmdbTaxonomy(kind, id); err != nil {
			t.Fatalf("[%s] 删除父节点失败: %v", kind, err)
		}
		if list, _ := s.ListCmdbTaxonomy(kind); len(list) != 0 {
			t.Fatalf("[%s] 删除后应为空，实际 %d", kind, len(list))
		}
	}
}

func TestCmdbTaxonomyValidation(t *testing.T) {
	s := newCmdbTestStore(t)

	if _, err := s.CreateCmdbTaxonomy("unknown", "x", 0, 0); err == nil {
		t.Fatalf("未知维度必须报错")
	}
	if _, err := s.CreateCmdbTaxonomy("orgs", "   ", 0, 0); err == nil {
		t.Fatalf("空名称必须报错")
	}
	if _, err := s.CreateCmdbTaxonomy("orgs", "立案庭", 999999, 0); err == nil {
		t.Fatalf("上级不存在必须报错")
	}

	id, err := s.CreateCmdbTaxonomy("orgs", "立案庭", 0, 0)
	if err != nil {
		t.Fatalf("新增失败: %v", err)
	}
	// 同级同名
	if _, err := s.CreateCmdbTaxonomy("orgs", "立案庭", 0, 0); err == nil {
		t.Fatalf("同级同名必须报错")
	}
	// 自己不能作为自己的上级
	if err := s.UpdateCmdbTaxonomy("orgs", id, "立案庭", id, 0); err == nil {
		t.Fatalf("上级不能是自己")
	}
	// 不能挂到自己的子孙下
	child, _ := s.CreateCmdbTaxonomy("orgs", "立案窗口", id, 0)
	if err := s.UpdateCmdbTaxonomy("orgs", id, "立案庭", child, 0); err == nil {
		t.Fatalf("上级不能是自己的下级节点")
	}
}

func TestCmdbTaxonomyDeleteBlockedByAssetReference(t *testing.T) {
	s := newCmdbTestStore(t)

	orgID, err := s.CreateCmdbTaxonomy("orgs", "执行局", 0, 0)
	if err != nil {
		t.Fatalf("新增组织失败: %v", err)
	}
	insertCmdbAsset(t, s, CmdbAsset{Name: "被引用的资产", AssetCode: "ZC-REF-1", Status: "在线", OrgID: orgID})

	list, _ := s.ListCmdbTaxonomy("orgs")
	if len(list) != 1 || list[0].AssetCount != 1 {
		t.Fatalf("被引用数应为 1，实际 %+v", list)
	}

	err = s.DeleteCmdbTaxonomy("orgs", orgID)
	if err == nil {
		t.Fatalf("已被资产引用时必须拒绝删除")
	}
	if list, _ := s.ListCmdbTaxonomy("orgs"); len(list) != 1 {
		t.Fatalf("拒绝删除后节点应仍然存在")
	}
}
