package store

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestWorkOrderImportIsAtomicAndScopesAssetReferences(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	other, err := s.CreateCmdbProject(&CmdbProject{Code: "import-other", Name: "另一项目"})
	if err != nil {
		t.Fatal(err)
	}
	assetID, err := s.CreateAssetForProject(ProjectScope{ProjectID: other.ID}, &Asset{AssetCode: "PRIVATE-PC"}, "测试")
	if err != nil {
		t.Fatal(err)
	}
	data := fmt.Sprintf("subject,assets\n正常工单,\n外项目资产,\"[{\"\"asset_type\"\":\"\"terminal\"\",\"\"asset_id\"\":%d}]\"\n", assetID)
	result, err := s.ImportCmdbWorkOrdersForProject(scope, strings.NewReader(data), true)
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 2 || result.Valid != 1 || result.Created != 0 || len(result.Errors) != 1 {
		t.Fatalf("invalid import result: %+v", result)
	}
	_, total, err := s.QueryCmdbWorkOrdersForProject(scope, CmdbWorkOrderQuery{Page: 1, PageSize: 10})
	if err != nil || total != 0 {
		t.Fatalf("partial commit: total=%d err=%v", total, err)
	}
	var logs int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM cmdb_work_order_logs WHERE project_id=?`, scope.ProjectID).Scan(&logs); err != nil {
		t.Fatal(err)
	}
	if logs != 0 {
		t.Fatalf("rollback retained %d logs", logs)
	}
	result, err = s.ImportCmdbWorkOrdersForProject(scope, strings.NewReader("subject,status\n跳过流程,已关闭\n"), true)
	if err != nil {
		t.Fatal(err)
	}
	if result.Created != 0 || result.Valid != 0 {
		t.Fatalf("import bypassed lifecycle: %+v", result)
	}
}

func TestWorkOrderLogsRollBackWithFailedUpdatesAndBatchClosure(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	first := &CmdbWorkOrder{Subject: "第一张", Owner: "登记人", Maintainer: "处理人"}
	firstID, err := s.CreateCmdbWorkOrderForProject(scope, first)
	if err != nil {
		t.Fatal(err)
	}
	secondID, err := s.CreateCmdbWorkOrderForProject(scope, &CmdbWorkOrder{Subject: "第二张"})
	if err != nil {
		t.Fatal(err)
	}
	first.Status = "已解决"
	if err := s.UpdateCmdbWorkOrderForProject(scope, first); err == nil {
		t.Fatal("skipping processing should fail")
	}
	logs, err := s.ListCmdbWorkOrderLogsForProject(scope, firstID)
	if err != nil || len(logs) != 1 {
		t.Fatalf("failed update wrote a log: %+v %v", logs, err)
	}
	for _, status := range []string{"处理中", "已解决"} {
		first.Status = status
		if err := s.UpdateCmdbWorkOrderForProject(scope, first); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.CloseCmdbWorkOrdersForProject(scope, []CmdbWorkOrderClosure{{ID: firstID, Result: "修复完成"}, {ID: secondID, Result: "尚未处理"}}); err == nil {
		t.Fatal("batch with unresolved order must fail")
	}
	got, err := s.GetCmdbWorkOrderForProject(scope, firstID)
	if err != nil || got.Status != "已解决" || got.ClosedAt != "" {
		t.Fatalf("batch did not roll back: %+v %v", got, err)
	}
	logs, err = s.ListCmdbWorkOrderLogsForProject(scope, firstID)
	if err != nil || len(logs) != 3 {
		t.Fatalf("batch rollback retained log: %+v %v", logs, err)
	}
	if _, err := s.CloseCmdbWorkOrdersForProject(scope, []CmdbWorkOrderClosure{{ID: firstID, Result: "修复完成"}}); err != nil {
		t.Fatal(err)
	}
	logs, err = s.ListCmdbWorkOrderLogsForProject(scope, firstID)
	if err != nil || len(logs) != 4 || logs[0].Action != "已关闭" || logs[0].Content != "修复完成" {
		t.Fatalf("closure log missing: %+v %v", logs, err)
	}
}

func TestWorkOrderHistorySnapshotRemapsOrderReferences(t *testing.T) {
	source, scope := openSnapshotTestStore(t)
	id, err := source.CreateCmdbWorkOrderForProject(scope, &CmdbWorkOrder{Subject: "同步履历"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := source.AddCmdbWorkOrderLogForProject(scope, id, "现场排查", "李四"); err != nil {
		t.Fatal(err)
	}
	other, err := source.CreateCmdbProject(&CmdbProject{Code: "private-history", Name: "其他项目"})
	if err != nil {
		t.Fatal(err)
	}
	otherID, err := source.CreateCmdbWorkOrderForProject(ProjectScope{ProjectID: other.ID}, &CmdbWorkOrder{Subject: "其他项目保密工单"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := source.AddCmdbWorkOrderLogForProject(ProjectScope{ProjectID: other.ID}, otherID, "其他项目保密履历", "王五"); err != nil {
		t.Fatal(err)
	}
	without, err := source.ExportCmdbSnapshot(scope, SnapshotExportOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := without.Collections["cmdb_work_order_logs"]; exists {
		t.Fatal("history opt-out leaked order logs")
	}
	snapshot, err := source.ExportCmdbSnapshot(scope, SnapshotExportOptions{IncludeHistory: true})
	if err != nil {
		t.Fatal(err)
	}
	var exported []map[string]interface{}
	if err := json.Unmarshal(snapshot.Collections["cmdb_work_order_logs"], &exported); err != nil {
		t.Fatal(err)
	}
	if len(exported) != 2 {
		t.Fatalf("exported logs: %+v", exported)
	}
	for _, row := range exported {
		if _, exists := row["work_order_id"]; exists {
			t.Fatal("snapshot leaked local order ID")
		}
		if _, exists := row["_refs"]; !exists {
			t.Fatal("snapshot lost order reference")
		}
	}
	target, targetScope := openSnapshotTestStore(t)
	alignSnapshotProject(t, target, targetScope, snapshot.ProjectSyncID)
	if _, err := target.ApplyCmdbSnapshot(targetScope, snapshot); err != nil {
		t.Fatal(err)
	}
	orders, total, err := target.QueryCmdbWorkOrdersForProject(targetScope, CmdbWorkOrderQuery{Page: 1, PageSize: 10})
	if err != nil || total != 1 {
		t.Fatalf("restored orders: %+v %v", orders, err)
	}
	logs, err := target.ListCmdbWorkOrderLogsForProject(targetScope, orders[0].ID)
	if err != nil || len(logs) != 2 {
		t.Fatalf("restored logs: %+v %v", logs, err)
	}
	found := false
	for _, item := range logs {
		if item.Content == "现场排查" && item.Operator == "李四" {
			found = true
		}
		if item.Content == "其他项目保密履历" {
			t.Fatal("snapshot leaked another project's history")
		}
	}
	if !found {
		t.Fatalf("saved record lost during remapping: %+v", logs)
	}
}
