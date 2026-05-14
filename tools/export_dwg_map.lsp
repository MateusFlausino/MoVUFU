(vl-load-com)

(setq mvp-route-layer "A-ACESS")
(setq mvp-background-layer "PDF_GEOMETRY")
(setq mvp-background-layer-keywords '("PDF_GEOMETRY" "PDF2_GEOMETRY" "GEOMETRY"))
(setq mvp-building-layer-keywords '("A-BLOCOS" "BLOCOS"))
(setq mvp-route-layer-keywords
  '("A-ACESS" "ACESS" "ACESSIBIL" "ROTA" "ROUTE" "CAMINHO" "PERCURSO" "PASSEIO" "CALCADA" "CALÇADA" "TRAVESSIA" "FAIXA" "RAMPA" "CRUZAMENTO" "CRUZ" "INTERSECAO" "INTERSEÇÃO" "INTERSECTION")
)
(setq mvp-feature-keywords
  '(("ramp" "RAMPA" "RAMP")
    ("crosswalk" "TRAVESSIA" "FAIXA" "PEDESTRE" "CROSSWALK")
    ("intersection" "CRUZAMENTO" "CRUZ" "INTERSECAO" "INTERSEÇÃO" "INTERSECTION")
    ("node" "NODE" "NO" "NÓ" "ACESS"))
)
(setq mvp-arc-segments 32)
(setq mvp-circle-segments 48)
(setq mvp-route-min-x nil)
(setq mvp-route-min-y nil)
(setq mvp-route-max-x nil)
(setq mvp-route-max-y nil)

(defun mvp-json-escape (value / text index char output)
  (setq text (vl-princ-to-string (if value value "")))
  (setq index 1)
  (setq output "")
  (while (<= index (strlen text))
    (setq char (substr text index 1))
    (cond
      ((= char "\\") (setq output (strcat output "\\\\")))
      ((= char "\"") (setq output (strcat output "\\\"")))
      (T (setq output (strcat output char)))
    )
    (setq index (1+ index))
  )
  output
)

(defun mvp-num (value)
  (rtos (float (if value value 0.0)) 2 8)
)

(defun mvp-layer-eq (layer target)
  (= (strcase (if layer layer "")) (strcase target))
)

(defun mvp-text-contains-any-p (text keywords / normalized found keyword)
  (setq normalized (strcase (if text text "")))
  (setq found nil)
  (foreach keyword keywords
    (if (and (not found) (vl-string-search (strcase keyword) normalized))
      (setq found T)
    )
  )
  found
)

(defun mvp-attrs-text (attrs / output pair)
  (setq output "")
  (foreach pair attrs
    (setq output (strcat output " " (car pair) " " (cdr pair)))
  )
  output
)

(defun mvp-attrs-json (attrs / output first pair)
  (setq output "{")
  (setq first T)
  (foreach pair attrs
    (if first
      (setq first nil)
      (setq output (strcat output ","))
    )
    (setq output
      (strcat
        output
        "\"" (mvp-json-escape (car pair)) "\":"
        "\"" (mvp-json-escape (cdr pair)) "\""
      )
    )
  )
  (strcat output "}")
)

(defun mvp-json-bool (value / normalized)
  (setq normalized (strcase (vl-string-trim " \t\r\n" (if value value ""))))
  (if (member normalized '("TRUE" "T" "SIM" "YES" "1"))
    "true"
    "false"
  )
)

(defun mvp-classify-feature (block-name layer attrs / haystack result rule category keywords)
  (setq haystack (strcat (if block-name block-name "") " " (if layer layer "") " " (mvp-attrs-text attrs)))
  (setq result nil)
  (foreach rule mvp-feature-keywords
    (if (not result)
      (progn
        (setq category (car rule))
        (setq keywords (cdr rule))
        (if (mvp-text-contains-any-p haystack keywords)
          (setq result category)
        )
      )
    )
  )
  result
)

(defun mvp-route-layer-p (layer)
  (mvp-text-contains-any-p layer mvp-route-layer-keywords)
)

(defun mvp-background-layer-p (layer)
  (mvp-text-contains-any-p layer mvp-background-layer-keywords)
)

(defun mvp-building-layer-p (layer)
  (mvp-text-contains-any-p layer mvp-building-layer-keywords)
)

(defun mvp-point-json (point / x y z)
  (setq x (car point))
  (setq y (cadr point))
  (setq z (if (caddr point) (caddr point) 0.0))
  (strcat "{\"x\":" (mvp-num x) ",\"y\":" (mvp-num y) ",\"z\":" (mvp-num z) "}")
)

(defun mvp-make-point (x y)
  (list (float x) (float y) 0.0)
)

(defun mvp-reset-route-bounds ()
  (setq mvp-route-min-x nil)
  (setq mvp-route-min-y nil)
  (setq mvp-route-max-x nil)
  (setq mvp-route-max-y nil)
)

(defun mvp-remember-point (point / x y)
  (if point
    (progn
      (setq x (car point))
      (setq y (cadr point))
      (if (or (not mvp-route-min-x) (< x mvp-route-min-x)) (setq mvp-route-min-x x))
      (if (or (not mvp-route-max-x) (> x mvp-route-max-x)) (setq mvp-route-max-x x))
      (if (or (not mvp-route-min-y) (< y mvp-route-min-y)) (setq mvp-route-min-y y))
      (if (or (not mvp-route-max-y) (> y mvp-route-max-y)) (setq mvp-route-max-y y))
    )
  )
)

(defun mvp-remember-points (points)
  (foreach point points
    (mvp-remember-point point)
  )
)

(defun mvp-background-margin (/ width height diagonal)
  (if (and mvp-route-min-x mvp-route-max-x mvp-route-min-y mvp-route-max-y)
    (progn
      (setq width (- mvp-route-max-x mvp-route-min-x))
      (setq height (- mvp-route-max-y mvp-route-min-y))
      (setq diagonal (sqrt (+ (* width width) (* height height))))
      (max 30000.0 (* diagonal 0.18))
    )
    0.0
  )
)

(defun mvp-point-near-route-p (point / margin)
  (if (not (and point mvp-route-min-x mvp-route-max-x mvp-route-min-y mvp-route-max-y))
    T
    (progn
      (setq margin (mvp-background-margin))
      (and
        (>= (car point) (- mvp-route-min-x margin))
        (<= (car point) (+ mvp-route-max-x margin))
        (>= (cadr point) (- mvp-route-min-y margin))
        (<= (cadr point) (+ mvp-route-max-y margin))
      )
    )
  )
)

(defun mvp-points-near-route-p (points / found)
  (setq found nil)
  (foreach point points
    (if (mvp-point-near-route-p point)
      (setq found T)
    )
  )
  found
)

(defun mvp-get-attrs (entity-name entity-data / attrs next-name next-data entity-type tag value)
  (setq attrs '())
  (if (= 1 (cdr (assoc 66 entity-data)))
    (progn
      (setq next-name (entnext entity-name))
      (while next-name
        (setq next-data (entget next-name))
        (setq entity-type (cdr (assoc 0 next-data)))
        (cond
          ((= entity-type "ATTRIB")
            (setq tag (strcase (cdr (assoc 2 next-data))))
            (setq value (cdr (assoc 1 next-data)))
            (setq attrs (append attrs (list (cons tag value))))
          )
          ((= entity-type "SEQEND")
            (setq next-name nil)
          )
        )
        (if next-name
          (setq next-name (entnext next-name))
        )
      )
    )
  )
  attrs
)

(defun mvp-attr-value (attrs keys / result key match)
  (setq result nil)
  (foreach key keys
    (if (not result)
      (progn
        (setq match (assoc (strcase key) attrs))
        (if match
          (setq result (cdr match))
        )
      )
    )
  )
  result
)

(defun mvp-lwpoly-points (entity-data / points item)
  (setq points '())
  (foreach item entity-data
    (if (= (car item) 10)
      (setq points (cons (cdr item) points))
    )
  )
  (reverse points)
)

(defun mvp-poly-points (entity-name / points next-name next-data entity-type vertex)
  (setq points '())
  (setq next-name (entnext entity-name))
  (while next-name
    (setq next-data (entget next-name))
    (setq entity-type (cdr (assoc 0 next-data)))
    (cond
      ((= entity-type "VERTEX")
        (setq vertex (cdr (assoc 10 next-data)))
        (if vertex
          (setq points (cons vertex points))
        )
      )
      ((= entity-type "SEQEND")
        (setq next-name nil)
      )
    )
    (if next-name
      (setq next-name (entnext next-name))
    )
  )
  (reverse points)
)

(defun mvp-line-points (entity-data / start-point end-point)
  (setq start-point (cdr (assoc 10 entity-data)))
  (setq end-point (cdr (assoc 11 entity-data)))
  (if (and start-point end-point)
    (list start-point end-point)
    '()
  )
)

(defun mvp-arc-points (entity-data / center radius start-angle end-angle delta steps index angle points)
  (setq center (cdr (assoc 10 entity-data)))
  (setq radius (cdr (assoc 40 entity-data)))
  (setq start-angle (cdr (assoc 50 entity-data)))
  (setq end-angle (cdr (assoc 51 entity-data)))
  (setq points '())
  (if (and center radius start-angle end-angle)
    (progn
      (setq delta (- end-angle start-angle))
      (if (< delta 0)
        (setq delta (+ delta (* 2 pi)))
      )
      (setq steps (max 6 (min 96 (fix (+ 6 (* mvp-arc-segments (/ delta (* 2 pi))))))))
      (setq index 0)
      (while (<= index steps)
        (setq angle (+ start-angle (* delta (/ (float index) steps))))
        (setq points
          (cons
            (mvp-make-point
              (+ (car center) (* radius (cos angle)))
              (+ (cadr center) (* radius (sin angle)))
            )
            points
          )
        )
        (setq index (1+ index))
      )
    )
  )
  (reverse points)
)

(defun mvp-circle-points (entity-data / center radius index angle points)
  (setq center (cdr (assoc 10 entity-data)))
  (setq radius (cdr (assoc 40 entity-data)))
  (setq points '())
  (if (and center radius)
    (progn
      (setq index 0)
      (while (<= index mvp-circle-segments)
        (setq angle (* 2 pi (/ (float index) mvp-circle-segments)))
        (setq points
          (cons
            (mvp-make-point
              (+ (car center) (* radius (cos angle)))
              (+ (cadr center) (* radius (sin angle)))
            )
            points
          )
        )
        (setq index (1+ index))
      )
    )
  )
  (reverse points)
)

(defun mvp-entity-points (entity-name entity-data / entity-type)
  (setq entity-type (cdr (assoc 0 entity-data)))
  (cond
    ((= entity-type "LWPOLYLINE") (mvp-lwpoly-points entity-data))
    ((= entity-type "POLYLINE") (mvp-poly-points entity-name))
    ((= entity-type "LINE") (mvp-line-points entity-data))
    ((= entity-type "ARC") (mvp-arc-points entity-data))
    ((= entity-type "CIRCLE") (mvp-circle-points entity-data))
    (T '())
  )
)

(defun mvp-closed-entity-p (entity-data / entity-type closed-flag)
  (setq entity-type (cdr (assoc 0 entity-data)))
  (setq closed-flag (cdr (assoc 70 entity-data)))
  (or
    (= entity-type "CIRCLE")
    (and closed-flag (= 1 (logand closed-flag 1)))
  )
)

(defun mvp-export-building-poly (file id entity-type layer points first /)
  (if first
    (setq first nil)
    (write-line "," file)
  )
  (mvp-write-poly-item file id entity-type layer "true" points)
  first
)

(defun mvp-insert-scale (entity-data group-code / value)
  (setq value (cdr (assoc group-code entity-data)))
  (if value (float value) 1.0)
)

(defun mvp-transform-insert-point (point insert-data / base x-scale y-scale rotation x y rotated-x rotated-y)
  (setq base (cdr (assoc 10 insert-data)))
  (setq x-scale (mvp-insert-scale insert-data 41))
  (setq y-scale (mvp-insert-scale insert-data 42))
  (setq rotation (cdr (assoc 50 insert-data)))
  (if (not rotation) (setq rotation 0.0))
  (setq x (* (car point) x-scale))
  (setq y (* (cadr point) y-scale))
  (setq rotated-x (- (* x (cos rotation)) (* y (sin rotation))))
  (setq rotated-y (+ (* x (sin rotation)) (* y (cos rotation))))
  (list
    (+ (car base) rotated-x)
    (+ (cadr base) rotated-y)
    (+ (if (caddr base) (caddr base) 0.0) (if (caddr point) (caddr point) 0.0))
  )
)

(defun mvp-transform-insert-points (points insert-data / transformed)
  (setq transformed '())
  (foreach point points
    (setq transformed (cons (mvp-transform-insert-point point insert-data) transformed))
  )
  (reverse transformed)
)

(defun mvp-export-insert-building-parts (file entity-name entity-data first exported-count / block-name block-record item-name item-data item-type raw-points points layer)
  (setq block-name (cdr (assoc 2 entity-data)))
  (setq block-record (if block-name (tblobjname "BLOCK" block-name) nil))
  (setq layer (cdr (assoc 8 entity-data)))
  (if block-record
    (progn
      (setq item-name (entnext block-record))
      (while item-name
        (setq item-data (entget item-name))
        (setq item-type (cdr (assoc 0 item-data)))
        (cond
          ((= item-type "ENDBLK")
            (setq item-name nil)
          )
          ((and
              (member item-type '("LWPOLYLINE" "POLYLINE" "CIRCLE"))
              (mvp-closed-entity-p item-data)
            )
            (setq raw-points (mvp-entity-points item-name item-data))
            (setq points (mvp-transform-insert-points raw-points entity-data))
            (if (>= (length points) 3)
              (progn
                (setq first (mvp-export-building-poly file (strcat "building-" (itoa (1+ exported-count))) "INSERT" layer points first))
                (setq exported-count (1+ exported-count))
              )
            )
          )
        )
        (if item-name
          (setq item-name (entnext item-name))
        )
      )
    )
  )
  (list first exported-count)
)

(defun mvp-write-points (file points / first point)
  (write-line "[" file)
  (setq first T)
  (foreach point points
    (if first
      (setq first nil)
      (write-line "," file)
    )
    (write-line (mvp-point-json point) file)
  )
  (write-line "]" file)
)

(defun mvp-write-poly-item (file id entity-type layer closed-text points /)
  (write-line
    (strcat
      "{\"id\":\"" (mvp-json-escape id) "\","
      "\"type\":\"" (mvp-json-escape entity-type) "\","
      "\"layer\":\"" (mvp-json-escape layer) "\","
      "\"closed\":" closed-text ","
      "\"points\":"
    )
    file
  )
  (mvp-write-points file points)
  (write-line "}" file)
)

(defun mvp-text-value (entity-data / value item)
  (setq value (cdr (assoc 1 entity-data)))
  (foreach item entity-data
    (if (= (car item) 3)
      (setq value (strcat (if value value "") (cdr item)))
    )
  )
  value
)

(defun mvp-export-nodes (file / selection count index entity-name entity-data attrs node-id block-name layer point first exported-count handle category prefix seen-ids clean-id found-id node-name node-flow node-accessible node-level node-type)
  (setq exported-count 0)
  (setq seen-ids '())
  (setq selection (ssget "X" (list (cons 0 "INSERT"))))
  (write-line "\"nodes\":[" file)
  (setq first T)
  (if selection
    (progn
      (setq count (sslength selection))
      (setq index 0)
      (while (< index count)
        (setq entity-name (ssname selection index))
        (setq entity-data (entget entity-name))
        (setq attrs (mvp-get-attrs entity-name entity-data))
        (setq node-id (mvp-attr-value attrs '("ID" "NODE" "NO" "N" "NOME" "NAME")))
        (setq node-name (mvp-attr-value attrs '("DESCRICAO" "DESCRIÇÃO" "DESCRIPTION" "LABEL" "NOME" "NAME")))
        (setq node-flow (mvp-attr-value attrs '("FLUXO" "FLOW")))
        (setq node-accessible (mvp-attr-value attrs '("ACESSIVEL" "ACESSÍVEL" "ACCESSIBLE" "PCD")))
        (setq node-level (mvp-attr-value attrs '("NIVEL" "NÍVEL" "LEVEL" "FLOOR" "PAVIMENTO")))
        (setq node-type (mvp-attr-value attrs '("TIPO" "TYPE" "CATEGORY" "CATEGORIA")))
        (setq block-name (cdr (assoc 2 entity-data)))
        (setq layer (cdr (assoc 8 entity-data)))
        (setq point (cdr (assoc 10 entity-data)))
        (setq handle (cdr (assoc 5 entity-data)))
        (setq category (mvp-classify-feature block-name layer attrs))
        (if (and (not node-id) handle)
          (progn
            (setq prefix
              (cond
                ((= category "ramp") "R")
                ((= category "crosswalk") "T")
                ((= category "intersection") "C")
                (T "N")
              )
            )
            (setq node-id (strcat prefix "-" handle))
          )
        )
        (setq clean-id (vl-string-trim " \t\r\n" (if node-id node-id "")))
        (setq found-id (assoc (strcase clean-id) seen-ids))
        (if (and found-id handle)
          (setq clean-id (strcat clean-id "-" handle))
        )
        (if (and clean-id (/= clean-id "") point (or category (mvp-layer-eq layer mvp-route-layer)))
          (progn
            (setq seen-ids (append seen-ids (list (cons (strcase clean-id) T))))
            (mvp-remember-point point)
            (if first
              (setq first nil)
              (write-line "," file)
            )
            (write-line
              (strcat
                "{\"id\":\"" (mvp-json-escape clean-id) "\"," 
                "\"blockName\":\"" (mvp-json-escape block-name) "\"," 
                "\"layer\":\"" (mvp-json-escape layer) "\"," 
                "\"category\":\"" (mvp-json-escape (if category category "node")) "\"," 
                "\"name\":\"" (mvp-json-escape node-name) "\","
                "\"flow\":\"" (mvp-json-escape node-flow) "\","
                "\"accessible\":" (mvp-json-bool node-accessible) ","
                "\"level\":\"" (mvp-json-escape node-level) "\","
                "\"type\":\"" (mvp-json-escape node-type) "\","
                "\"attributes\":" (mvp-attrs-json attrs) ","
                "\"position\":" (mvp-point-json point) "}"
              )
              file
            )
            (setq exported-count (1+ exported-count))
          )
        )
        (setq index (1+ index))
      )
    )
  )
  (write-line "]," file)
  exported-count
)

(defun mvp-export-route-polylines (file / selection count index entity-name entity-data entity-type layer points first exported-count closed-flag closed-text)
  (setq exported-count 0)
  (setq selection (ssget "X" (list (cons 0 "LWPOLYLINE,POLYLINE,LINE"))))
  (write-line "\"polylines\":[" file)
  (setq first T)
  (if selection
    (progn
      (setq count (sslength selection))
      (setq index 0)
      (while (< index count)
        (setq entity-name (ssname selection index))
        (setq entity-data (entget entity-name))
        (setq entity-type (cdr (assoc 0 entity-data)))
        (setq layer (cdr (assoc 8 entity-data)))
        (setq closed-flag (cdr (assoc 70 entity-data)))
        (setq closed-text (if (and closed-flag (= 1 (logand closed-flag 1))) "true" "false"))
        (setq points (mvp-entity-points entity-name entity-data))
        (if (and (>= (length points) 2) (mvp-route-layer-p layer))
          (progn
            (mvp-remember-points points)
            (if first
              (setq first nil)
              (write-line "," file)
            )
            (mvp-write-poly-item file (strcat "route-" (itoa (1+ exported-count))) entity-type layer closed-text points)
            (setq exported-count (1+ exported-count))
          )
        )
        (setq index (1+ index))
      )
    )
  )
  (write-line "]," file)
  exported-count
)

(defun mvp-export-background (file / selection count index entity-name entity-data entity-type layer points first exported-count closed-flag closed-text)
  (setq exported-count 0)
  (setq selection (ssget "X" (list (cons 0 "LWPOLYLINE,POLYLINE,LINE,ARC,CIRCLE"))))
  (write-line "\"background\":[" file)
  (setq first T)
  (if selection
    (progn
      (setq count (sslength selection))
      (setq index 0)
      (while (< index count)
        (setq entity-name (ssname selection index))
        (setq entity-data (entget entity-name))
        (setq entity-type (cdr (assoc 0 entity-data)))
        (setq layer (cdr (assoc 8 entity-data)))
        (setq closed-flag (cdr (assoc 70 entity-data)))
        (setq closed-text (if (or (= entity-type "CIRCLE") (and closed-flag (= 1 (logand closed-flag 1)))) "true" "false"))
        (setq points (mvp-entity-points entity-name entity-data))
        (if (and (>= (length points) 2) (mvp-background-layer-p layer) (mvp-points-near-route-p points))
          (progn
            (if first
              (setq first nil)
              (write-line "," file)
            )
            (mvp-write-poly-item file (strcat "bg-" (itoa (1+ exported-count))) entity-type layer closed-text points)
            (setq exported-count (1+ exported-count))
          )
        )
        (setq index (1+ index))
      )
    )
  )
  (write-line "]" file)
  exported-count
)

(defun mvp-export-buildings (file / selection count index entity-name entity-data entity-type layer points first exported-count insert-result)
  (setq exported-count 0)
  (setq selection (ssget "X" (list (cons 0 "LWPOLYLINE,POLYLINE,CIRCLE,INSERT"))))
  (write-line "\"buildings\":[" file)
  (setq first T)
  (if selection
    (progn
      (setq count (sslength selection))
      (setq index 0)
      (while (< index count)
        (setq entity-name (ssname selection index))
        (setq entity-data (entget entity-name))
        (setq entity-type (cdr (assoc 0 entity-data)))
        (setq layer (cdr (assoc 8 entity-data)))
        (if (mvp-building-layer-p layer)
          (cond
            ((= entity-type "INSERT")
              (setq insert-result (mvp-export-insert-building-parts file entity-name entity-data first exported-count))
              (setq first (car insert-result))
              (setq exported-count (cadr insert-result))
            )
            (T
              (setq points (mvp-entity-points entity-name entity-data))
              (if (and (mvp-closed-entity-p entity-data) (>= (length points) 3))
                (progn
                  (setq first (mvp-export-building-poly file (strcat "building-" (itoa (1+ exported-count))) entity-type layer points first))
                  (setq exported-count (1+ exported-count))
                )
              )
            )
          )
        )
        (setq index (1+ index))
      )
    )
  )
  (write-line "]" file)
  exported-count
)

(defun mvp-export-building-labels (file / selection count index entity-name entity-data entity-type layer point text first exported-count)
  (setq exported-count 0)
  (setq selection (ssget "X" (list (cons 0 "TEXT,MTEXT"))))
  (write-line "\"buildingLabels\":[" file)
  (setq first T)
  (if selection
    (progn
      (setq count (sslength selection))
      (setq index 0)
      (while (< index count)
        (setq entity-name (ssname selection index))
        (setq entity-data (entget entity-name))
        (setq entity-type (cdr (assoc 0 entity-data)))
        (setq layer (cdr (assoc 8 entity-data)))
        (setq point (cdr (assoc 10 entity-data)))
        (setq text (vl-string-trim " \t\r\n" (if (mvp-text-value entity-data) (mvp-text-value entity-data) "")))
        (if (and point (/= text "") (mvp-building-layer-p layer))
          (progn
            (if first
              (setq first nil)
              (write-line "," file)
            )
            (write-line
              (strcat
                "{\"id\":\"building-label-" (itoa (1+ exported-count)) "\","
                "\"type\":\"" (mvp-json-escape entity-type) "\","
                "\"layer\":\"" (mvp-json-escape layer) "\","
                "\"name\":\"" (mvp-json-escape text) "\","
                "\"position\":" (mvp-point-json point) "}"
              )
              file
            )
            (setq exported-count (1+ exported-count))
          )
        )
        (setq index (1+ index))
      )
    )
  )
  (write-line "]" file)
  exported-count
)

(defun export-dwg-map (output-path / file node-count polyline-count background-count building-count building-label-count source-name)
  (setq file (open output-path "w"))
  (if file
    (progn
      (setq source-name (strcat (getvar "DWGPREFIX") (getvar "DWGNAME")))
      (write-line "{" file)
      (write-line (strcat "\"source\":\"" (mvp-json-escape source-name) "\",") file)
      (write-line (strcat "\"routeLayer\":\"" (mvp-json-escape mvp-route-layer) "\",") file)
      (write-line (strcat "\"backgroundLayer\":\"PDF_Geometry\",") file)
      (mvp-reset-route-bounds)
      (setq node-count (mvp-export-nodes file))
      (setq polyline-count (mvp-export-route-polylines file))
      (setq background-count (mvp-export-background file))
      (write-line "," file)
      (setq building-count (mvp-export-buildings file))
      (write-line "," file)
      (setq building-label-count (mvp-export-building-labels file))
      (write-line "," file)
      (write-line
        (strcat
          "\"summary\":{\"nodes\":" (itoa node-count)
          ",\"polylines\":" (itoa polyline-count)
          ",\"background\":" (itoa background-count)
          ",\"buildings\":" (itoa building-count)
          ",\"buildingLabels\":" (itoa building-label-count)
          "}"
        )
        file
      )
      (write-line "}" file)
      (close file)
      (princ (strcat "\nDWG map exported to " output-path "\n"))
      (princ
        (strcat
          "Nodes: " (itoa node-count)
          " | Route polylines: " (itoa polyline-count)
          " | Background entities: " (itoa background-count)
          " | Buildings: " (itoa building-count)
          " | Building labels: " (itoa building-label-count)
          "\n"
        )
      )
    )
    (princ (strcat "\nCould not open output file: " output-path "\n"))
  )
  (princ)
)
