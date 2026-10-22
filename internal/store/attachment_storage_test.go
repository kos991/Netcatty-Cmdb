package store

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func createAttachmentStorageFixture(t *testing.T) (*Store, ProjectScope, int64, *WorkOrderAttachment) {
	t.Helper()
	st := newCmdbTestStore(t)
	scope, err := st.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	workOrderID, err := st.CreateCmdbWorkOrderForProject(scope, &CmdbWorkOrder{Subject: "附件目录迁移"})
	if err != nil {
		t.Fatal(err)
	}
	attachment, err := st.SaveWorkOrderAttachmentForProject(scope, workOrderID, "证据.txt", "text/plain", strings.NewReader("evidence"))
	if err != nil {
		t.Fatal(err)
	}
	return st, scope, workOrderID, attachment
}

func TestAttachmentStorageStatusUsesProjectDefaultAndCustomRoot(t *testing.T) {
	st := newCmdbTestStore(t)
	scope, err := st.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	status, err := st.GetAttachmentStorageStatus(scope)
	if err != nil {
		t.Fatal(err)
	}
	wantDefault := filepath.Join(filepath.Dir(st.path), "cmdb", "attachments", fmt.Sprintf("project-%d", scope.ProjectID))
	if status.EffectiveRoot != wantDefault || !status.UsesDefault || !status.Writable {
		t.Fatalf("默认附件目录状态异常: %+v want=%q", status, wantDefault)
	}

	customRoot := filepath.Join(t.TempDir(), "custom-project-root")
	if err := st.UpdateProjectAttachmentRoot(scope.ProjectID, customRoot); err != nil {
		t.Fatal(err)
	}
	status, err = st.GetAttachmentStorageStatus(scope)
	if err != nil {
		t.Fatal(err)
	}
	if status.EffectiveRoot != customRoot || status.UsesDefault {
		t.Fatalf("自定义附件目录状态异常: %+v", status)
	}
}

func TestMigrateAttachmentStorageCopiesAndVerifiesProjectFiles(t *testing.T) {
	st, scope, workOrderID, attachment := createAttachmentStorageFixture(t)
	oldPath := attachment.StoredPath
	target := filepath.Join(t.TempDir(), "migrated")

	preview, err := st.PreflightAttachmentStorageMigration(scope, target)
	if err != nil {
		t.Fatal(err)
	}
	if preview.FileCount != 1 || preview.SizeBytes != int64(len("evidence")) {
		t.Fatalf("迁移预检异常: %+v", preview)
	}
	result, err := st.MigrateAttachmentStorage(scope, target)
	if err != nil {
		t.Fatal(err)
	}
	if result.MigratedFiles != 1 || result.TargetRoot != target {
		t.Fatalf("迁移结果异常: %+v", result)
	}
	if _, err := os.Stat(oldPath); err != nil {
		t.Fatalf("旧附件副本应保留: %v", err)
	}
	migrated, err := st.GetWorkOrderAttachmentForProject(scope, workOrderID, attachment.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(filepath.Clean(migrated.StoredPath), filepath.Clean(target)+string(os.PathSeparator)) {
		t.Fatalf("迁移后仍未使用目标目录: %q", migrated.StoredPath)
	}
	content, err := os.ReadFile(migrated.StoredPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "evidence" {
		t.Fatalf("迁移内容错误: %q", content)
	}
}

func TestMigrateAttachmentStorageKeepsOldRootWhenSourceIsMissing(t *testing.T) {
	st, scope, _, attachment := createAttachmentStorageFixture(t)
	projectBefore, err := st.ResolveProject(scope)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(attachment.StoredPath); err != nil {
		t.Fatal(err)
	}
	casPath, err := st.BuildAttachmentLocalPathForProject(scope, attachment.ContentHash)
	if err != nil {
		t.Fatal(err)
	}
	_ = os.Remove(casPath)

	_, err = st.MigrateAttachmentStorage(scope, filepath.Join(t.TempDir(), "broken-migration"))
	if err == nil {
		t.Fatal("源附件缺失时迁移必须失败")
	}
	projectAfter, resolveErr := st.ResolveProject(scope)
	if resolveErr != nil {
		t.Fatal(resolveErr)
	}
	if projectAfter.AttachmentRoot != projectBefore.AttachmentRoot {
		t.Fatalf("迁移失败仍切换了目录: before=%q after=%q", projectBefore.AttachmentRoot, projectAfter.AttachmentRoot)
	}
}
