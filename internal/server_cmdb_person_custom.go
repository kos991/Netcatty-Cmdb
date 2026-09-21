package internal

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"czfy-assets/internal/store"
)

// handleListPersons 处理 GET /api/cmdb/persons
func (s *Server) handleListPersons(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 50
	}

	query := store.PersonQuery{
		Keyword:    strings.TrimSpace(q.Get("keyword")),
		Department: strings.TrimSpace(q.Get("department")),
		OrgName:    strings.TrimSpace(q.Get("org_name")),
		GroupName:  strings.TrimSpace(q.Get("group_name")),
		Status:     strings.TrimSpace(q.Get("status")),
		Page:       page,
		PageSize:   pageSize,
	}

	list, total, err := s.Store.ListPersonsForProject(scope, query)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if list == nil {
		list = []store.Person{}
	}
	writeJSON(w, 200, listResponse(list, total, page, pageSize))
}

// handleCreatePerson 处理 POST /api/cmdb/persons
func (s *Server) handleCreatePerson(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	var body store.Person
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	id, err := s.Store.CreatePersonForProject(scope, &body)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"id": id})
}

// handleUpdatePerson 处理 PUT /api/cmdb/persons/{id}
func (s *Server) handleUpdatePerson(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, ok := cmdbPathID(r)
	if !ok {
		writeErr(w, 400, "无效的人员 ID")
		return
	}
	var body store.Person
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	body.ID = id
	if err := s.Store.UpdatePersonForProject(scope, &body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"success": true})
}

// handleDeletePerson 处理 DELETE /api/cmdb/persons/{id}
func (s *Server) handleDeletePerson(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, ok := cmdbPathID(r)
	if !ok {
		writeErr(w, 400, "无效的人员 ID")
		return
	}
	if err := s.Store.DeletePersonForProject(scope, id); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"success": true})
}

// handleGetPersonAssets 处理 GET /api/cmdb/persons/{id}/assets
func (s *Server) handleGetPersonAssets(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, ok := cmdbPathID(r)
	if !ok {
		writeErr(w, 400, "无效的人员 ID")
		return
	}
	person, assets, err := s.Store.GetPersonAssetsForProject(scope, id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{
		"person": person,
		"assets": assets,
		"total":  len(assets),
	})
}

// handleTransferPersonAssets 处理 POST /api/cmdb/persons/transfer
func (s *Server) handleTransferPersonAssets(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	var body store.PersonTransferReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	transferred, err := s.Store.TransferPersonAssetsForProject(scope, body)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{
		"success":     true,
		"transferred": transferred,
	})
}

// handleListCustomFields 处理 GET /api/cmdb/custom-fields
func (s *Server) handleListCustomFields(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	assetClass := r.URL.Query().Get("asset_class")
	list, err := s.Store.ListCustomFieldsForProject(scope, assetClass)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if list == nil {
		list = []store.CustomField{}
	}
	writeJSON(w, 200, map[string]interface{}{"list": list, "total": len(list)})
}

// handleSaveCustomField 处理 POST /api/cmdb/custom-fields
func (s *Server) handleSaveCustomField(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	var body store.CustomField
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	id, err := s.Store.SaveCustomFieldForProject(scope, &body)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"id": id, "success": true})
}

// handleDeleteCustomField 处理 DELETE /api/cmdb/custom-fields/{id}
func (s *Server) handleDeleteCustomField(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	id, ok := cmdbPathID(r)
	if !ok {
		writeErr(w, 400, "无效的字段 ID")
		return
	}
	if err := s.Store.DeleteCustomFieldForProject(scope, id); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"success": true})
}
