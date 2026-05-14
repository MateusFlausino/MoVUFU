(vl-load-com)

(defun inspect-json-escape (value / text index char output)
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

(defun inspect-num (value)
  (rtos (float (if value value 0.0)) 2 8)
)

(defun inspect-point-json (point / x y z)
  (setq x (car point))
  (setq y (cadr point))
  (setq z (if (caddr point) (caddr point) 0.0))
  (strcat "{\"x\":" (inspect-num x) ",\"y\":" (inspect-num y) ",\"z\":" (inspect-num z) "}")
)

(defun inspect-attrs (entity-name entity-data / attrs next-name next-data entity-type tag value)
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

(defun inspect-write-attrs (file attrs / first pair)
  (write-line "\"attributes\":{" file)
  (setq first T)
  (foreach pair attrs
    (if first
      (setq first nil)
      (write-line "," file)
    )
    (write-line (strcat "\"" (inspect-json-escape (car pair)) "\":\"" (inspect-json-escape (cdr pair)) "\"") file)
  )
  (write-line "}" file)
)

(defun inspect-write-entity (file entity-name index / data entity-type layer point text block attrs)
  (setq data (entget entity-name))
  (setq entity-type (cdr (assoc 0 data)))
  (setq layer (cdr (assoc 8 data)))
  (setq point (cdr (assoc 10 data)))
  (setq text (cdr (assoc 1 data)))
  (setq block (cdr (assoc 2 data)))
  (setq attrs (if (= entity-type "INSERT") (inspect-attrs entity-name data) '()))
  (write-line "{" file)
  (write-line (strcat "\"index\":" (itoa index) ",") file)
  (write-line (strcat "\"handle\":\"" (inspect-json-escape (cdr (assoc 5 data))) "\",") file)
  (write-line (strcat "\"type\":\"" (inspect-json-escape entity-type) "\",") file)
  (write-line (strcat "\"layer\":\"" (inspect-json-escape layer) "\",") file)
  (write-line (strcat "\"blockName\":\"" (inspect-json-escape block) "\",") file)
  (write-line (strcat "\"text\":\"" (inspect-json-escape text) "\",") file)
  (if point
    (write-line (strcat "\"position\":" (inspect-point-json point) ",") file)
    (write-line "\"position\":null," file)
  )
  (inspect-write-attrs file attrs)
  (write-line "}" file)
)

(defun inspect-dwg (output-path / file selection count index entity-name first data key counts found layer entity-type key-list layer-list)
  (setq file (open output-path "w"))
  (if file
    (progn
      (setq counts '())
      (setq selection (ssget "X"))
      (if selection
        (progn
          (setq count (sslength selection))
          (setq index 0)
          (while (< index count)
            (setq entity-name (ssname selection index))
            (setq data (entget entity-name))
            (setq entity-type (cdr (assoc 0 data)))
            (setq layer (cdr (assoc 8 data)))
            (setq key (strcat entity-type "|" layer))
            (setq found (assoc key counts))
            (if found
              (setq counts (subst (cons key (1+ (cdr found))) found counts))
              (setq counts (append counts (list (cons key 1))))
            )
            (setq index (1+ index))
          )
        )
        (setq count 0)
      )
      (write-line "{" file)
      (write-line (strcat "\"source\":\"" (inspect-json-escape (strcat (getvar "DWGPREFIX") (getvar "DWGNAME"))) "\",") file)
      (write-line (strcat "\"entityCount\":" (itoa count) ",") file)
      (write-line "\"counts\":[" file)
      (setq first T)
      (foreach key counts
        (if first
          (setq first nil)
          (write-line "," file)
        )
        (setq key-list (vl-string-search "|" (car key)))
        (write-line
          (strcat
            "{\"type\":\"" (inspect-json-escape (substr (car key) 1 key-list)) "\","
            "\"layer\":\"" (inspect-json-escape (substr (car key) (+ key-list 2))) "\","
            "\"count\":" (itoa (cdr key)) "}"
          )
          file
        )
      )
      (write-line "]," file)
      (write-line "\"aAcessEntities\":[" file)
      (setq first T)
      (setq index 0)
      (setq found 0)
      (if selection
        (while (and (< index count) (< found 200))
          (setq entity-name (ssname selection index))
          (setq data (entget entity-name))
          (if (= (strcase (cdr (assoc 8 data))) "A-ACESS")
            (progn
              (if first
                (setq first nil)
                (write-line "," file)
              )
              (inspect-write-entity file entity-name (1+ index))
              (setq found (1+ found))
            )
          )
          (setq index (1+ index))
        )
      )
      (write-line "]" file)
      (write-line "}" file)
      (close file)
      (princ (strcat "\nInspection exported to " output-path "\n"))
    )
  )
  (princ)
)
