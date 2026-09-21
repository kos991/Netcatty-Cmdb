package internal

import (
	"encoding/json"
	"net/http"
	"strconv"

	"czfy-assets/internal/store"
)

// handleCreateCmdbAsset 手工新增一条 CMDB 资产（新增资产）。
func (s *Server) handleCreateCmdbAsset(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	var body store.CmdbAsset
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	id, err := s.Store.CreateCmdbAssetManualForProject(scope, &body)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"id": id})
}

// handleUpdateCmdbAsset 编辑单条 CMDB 资产；映射来的记录会反向写穿回源台账。
func (s *Server) handleUpdateCmdbAsset(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的资产 ID")
		return
	}
	var ch store.CmdbAssetChanges
	if err := json.NewDecoder(r.Body).Decode(&ch); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	n, err := s.Store.ApplyCmdbAssetChangesForProject(scope, []int64{id}, ch)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"updated": n})
}

// handleReplaceCmdbAsset 保存完整资产档案，包括网络接口与扩展字段。
// 原有 PUT 接口继续承担列表内的局部编辑，避免改变批量编辑语义。
func (s *Server) handleReplaceCmdbAsset(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的资产 ID")
		return
	}
	var body store.CmdbAsset
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	body.ID = id
	if err := s.Store.UpdateCmdbAssetManualForProject(scope, &body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

// handleDeleteCmdbAsset 删除单条 CMDB 资产（映射来的记录会被拒绝）。
func (s *Server) handleDeleteCmdbAsset(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的资产 ID")
		return
	}
	if err := s.Store.DeleteCmdbAssetForProject(scope, id); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

// handleBatchCmdbAssets 批量操作：edit（批量编辑）/ archive（批量归档）/ clone（批量克隆）。
func (s *Server) handleBatchCmdbAssets(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	var body struct {
		IDs     []int64                `json:"ids"`
		Action  string                 `json:"action"`
		Changes store.CmdbAssetChanges `json:"changes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	if len(body.IDs) == 0 {
		writeErr(w, 400, "请先选择要操作的资产")
		return
	}

	switch body.Action {
	case "edit":
		n, err := s.Store.ApplyCmdbAssetChangesForProject(scope, body.IDs, body.Changes)
		if err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		writeJSON(w, 200, map[string]interface{}{"affected": n, "action": "edit"})
	case "archive":
		n, err := s.Store.ArchiveCmdbAssetsForProject(scope, body.IDs)
		if err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		writeJSON(w, 200, map[string]interface{}{"affected": n, "action": "archive"})
	case "clone":
		n, err := s.Store.CloneCmdbAssetsForProject(scope, body.IDs)
		if err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		writeJSON(w, 200, map[string]interface{}{"affected": n, "action": "clone"})
	default:
		writeErr(w, 400, "不支持的操作: "+body.Action+"（仅支持 edit / archive / clone）")
	}
}
