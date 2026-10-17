package internal

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// handlePreviewTerminalNames 列出未命名终端及将生成的名称，不写库。
func (s *Server) handlePreviewTerminalNames(w http.ResponseWriter, r *http.Request) {
	list, err := s.Store.PreviewTerminalNameBackfillForProject(requestProjectScope(r))
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"list": list, "total": len(list)})
}

// handleApplyTerminalNames 为所有未命名终端写入自动名称。
func (s *Server) handleApplyTerminalNames(w http.ResponseWriter, r *http.Request) {
	count, err := s.Store.ApplyTerminalNameBackfillForProject(requestProjectScope(r))
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"updated": count})
}

// handleSetTerminalCategoryShortCode 维护终端设备类型简称（用于自动命名）。
func (s *Server) handleSetTerminalCategoryShortCode(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "无效的设备类型 ID")
		return
	}
	var body struct {
		ShortCode string `json:"short_code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	if err := s.Store.SetTerminalCategoryShortCodeForProject(requestProjectScope(r), id, body.ShortCode); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "1"})
}

// handleSubnetSuggestions 返回资产 IP 中尚未被网段覆盖的 /24 段。
func (s *Server) handleSubnetSuggestions(w http.ResponseWriter, r *http.Request) {
	list, err := s.Store.UncoveredAssetSubnetsForProject(requestProjectScope(r))
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"list": list})
}
