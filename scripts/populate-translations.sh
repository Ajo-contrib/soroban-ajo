#!/bin/bash

# Script to populate all translation files with complete content
# This script ensures all language translation files have complete content

set -e

LOCALES_DIR="/workspaces/soroban-ajo/packages/shared/locales"
LANGUAGES=("es" "fr" "sw" "ar" "pt" "zh")

# Function to populate a translation file
populate_file() {
  local language=$1
  local namespace=$2
  local file="$LOCALES_DIR/$language/$namespace.json"
  
  case "$namespace" in
    "auth")
      case "$language" in
        "es")
          cat > "$file" << 'EOF'
{
  "auth": {
    "login": "Iniciar sesión",
    "signup": "Registrarse",
    "signup_title": "Crear nueva cuenta",
    "email": "Correo electrónico",
    "password": "Contraseña",
    "password_confirm": "Confirmar contraseña",
    "remember_me": "Recuérdame",
    "forgot_password": "¿Olvidó su contraseña?",
    "reset_password": "Restablecer contraseña",
    "back_to_login": "Volver a iniciar sesión",
    "invalid_credentials": "Correo o contraseña inválidos",
    "password_mismatch": "Las contraseñas no coinciden",
    "signup_success": "Cuenta creada exitosamente",
    "login_success": "Inicio de sesión exitoso",
    "logout": "Cerrar sesión",
    "verify_email": "Verificar correo electrónico",
    "check_email": "Por favor, verifica tu correo electrónico",
    "resend_verification": "Reenviar verificación",
    "two_factor_enabled": "Autenticación de dos factores habilitada",
    "enter_2fa_code": "Ingresa tu código de autenticación de dos factores",
    "invalid_2fa_code": "Código de autenticación inválido"
  }
}
EOF
        ;;
        "fr")
          cat > "$file" << 'EOF'
{
  "auth": {
    "login": "Se connecter",
    "signup": "S'inscrire",
    "signup_title": "Créer un nouveau compte",
    "email": "Adresse e-mail",
    "password": "Mot de passe",
    "password_confirm": "Confirmer le mot de passe",
    "remember_me": "Se souvenir de moi",
    "forgot_password": "Mot de passe oublié?",
    "reset_password": "Réinitialiser le mot de passe",
    "back_to_login": "Retour à la connexion",
    "invalid_credentials": "Identifiants invalides",
    "password_mismatch": "Les mots de passe ne correspondent pas",
    "signup_success": "Compte créé avec succès",
    "login_success": "Connexion réussie",
    "logout": "Se déconnecter",
    "verify_email": "Vérifier l'adresse e-mail",
    "check_email": "Veuillez vérifier votre e-mail",
    "resend_verification": "Renvoyer la vérification",
    "two_factor_enabled": "Authentification à deux facteurs activée",
    "enter_2fa_code": "Entrez votre code d'authentification",
    "invalid_2fa_code": "Code d'authentification invalide"
  }
}
EOF
        ;;
        "sw")
          cat > "$file" << 'EOF'
{
  "auth": {
    "login": "Ingia",
    "signup": "Jandikisha",
    "signup_title": "Tengeneza akaunti mpya",
    "email": "Barua pepe",
    "password": "Nenosiri",
    "password_confirm": "Thibitisha nenosiri",
    "remember_me": "Nikumbuke",
    "forgot_password": "Umesahau nenosiri?",
    "reset_password": "Seti upya nenosiri",
    "back_to_login": "Rudi kwa kuingia",
    "invalid_credentials": "Nenosiri au barua pepe si sahihi",
    "password_mismatch": "Nenosiri haupatanishi",
    "signup_success": "Akaunti ilitengenezwa kwa mafanikiwa",
    "login_success": "Kuingia kwa mafanikiwa",
    "logout": "Toka",
    "verify_email": "Thibitisha barua pepe",
    "check_email": "Tafadhali thibitisha barua pepe yako",
    "resend_verification": "Tuma upya uthibitisho",
    "two_factor_enabled": "Uthibitisho wa mambo mawili umewezwa",
    "enter_2fa_code": "Ingiza nambari ya uthibitisho wako",
    "invalid_2fa_code": "Nambari ya uthibitisho si sahihi"
  }
}
EOF
        ;;
        "ar")
          cat > "$file" << 'EOF'
{
  "auth": {
    "login": "دخول",
    "signup": "تسجيل",
    "signup_title": "إنشاء حساب جديد",
    "email": "البريد الإلكتروني",
    "password": "كلمة المرور",
    "password_confirm": "تأكيد كلمة المرور",
    "remember_me": "تذكرني",
    "forgot_password": "هل نسيت كلمة المرور؟",
    "reset_password": "إعادة تعيين كلمة المرور",
    "back_to_login": "العودة إلى الدخول",
    "invalid_credentials": "بيانات اعتماد غير صحيحة",
    "password_mismatch": "كلمات المرور غير متطابقة",
    "signup_success": "تم إنشاء الحساب بنجاح",
    "login_success": "تم الدخول بنجاح",
    "logout": "تسجيل الخروج",
    "verify_email": "التحقق من البريد الإلكتروني",
    "check_email": "يرجى التحقق من بريدك الإلكتروني",
    "resend_verification": "إعادة إرسال التحقق",
    "two_factor_enabled": "تم تفعيل المصادقة الثنائية",
    "enter_2fa_code": "أدخل رمز المصادقة الخاص بك",
    "invalid_2fa_code": "رمز مصادقة غير صحيح"
  }
}
EOF
        ;;
        "pt")
          cat > "$file" << 'EOF'
{
  "auth": {
    "login": "Entrar",
    "signup": "Cadastre-se",
    "signup_title": "Criar nova conta",
    "email": "Email",
    "password": "Senha",
    "password_confirm": "Confirmar senha",
    "remember_me": "Lembre-se de mim",
    "forgot_password": "Esqueceu a senha?",
    "reset_password": "Redefinir senha",
    "back_to_login": "Voltar ao login",
    "invalid_credentials": "Credenciais inválidas",
    "password_mismatch": "As senhas não coincidem",
    "signup_success": "Conta criada com sucesso",
    "login_success": "Login bem-sucedido",
    "logout": "Sair",
    "verify_email": "Verificar email",
    "check_email": "Por favor, verifique seu email",
    "resend_verification": "Reenviar verificação",
    "two_factor_enabled": "Autenticação de dois fatores ativada",
    "enter_2fa_code": "Digite seu código de autenticação",
    "invalid_2fa_code": "Código de autenticação inválido"
  }
}
EOF
        ;;
        "zh")
          cat > "$file" << 'EOF'
{
  "auth": {
    "login": "登录",
    "signup": "注册",
    "signup_title": "创建新账户",
    "email": "电子邮件",
    "password": "密码",
    "password_confirm": "确认密码",
    "remember_me": "记住我",
    "forgot_password": "忘记密码?",
    "reset_password": "重置密码",
    "back_to_login": "返回登录",
    "invalid_credentials": "凭据无效",
    "password_mismatch": "密码不匹配",
    "signup_success": "账户创建成功",
    "login_success": "登录成功",
    "logout": "登出",
    "verify_email": "验证电子邮件",
    "check_email": "请验证您的电子邮件",
    "resend_verification": "重新发送验证",
    "two_factor_enabled": "启用两因素身份验证",
    "enter_2fa_code": "输入您的验证码",
    "invalid_2fa_code": "验证码无效"
  }
}
EOF
        ;;
      esac
      ;;
    "errors")
      case "$language" in
        "es")
          cat > "$file" << 'EOF'
{
  "errors": {
    "generic_error": "Ocurrió un error",
    "network_error": "Error de red",
    "not_found": "No encontrado",
    "unauthorized": "No autorizado",
    "forbidden": "Prohibido",
    "server_error": "Error del servidor",
    "validation_error": "Error de validación",
    "invalid_input": "Entrada inválida",
    "required_field": "Campo requerido",
    "invalid_email": "Correo electrónico inválido",
    "invalid_phone": "Número de teléfono inválido",
    "something_went_wrong": "Algo salió mal",
    "please_try_again": "Por favor, intenta de nuevo",
    "file_too_large": "Archivo demasiado grande",
    "unsupported_file_type": "Tipo de archivo no soportado"
  }
}
EOF
        ;;
        "fr")
          cat > "$file" << 'EOF'
{
  "errors": {
    "generic_error": "Une erreur s'est produite",
    "network_error": "Erreur réseau",
    "not_found": "Non trouvé",
    "unauthorized": "Non autorisé",
    "forbidden": "Interdit",
    "server_error": "Erreur serveur",
    "validation_error": "Erreur de validation",
    "invalid_input": "Entrée invalide",
    "required_field": "Champ obligatoire",
    "invalid_email": "Adresse e-mail invalide",
    "invalid_phone": "Numéro de téléphone invalide",
    "something_went_wrong": "Quelque chose s'est mal passé",
    "please_try_again": "Veuillez réessayer",
    "file_too_large": "Fichier trop volumineux",
    "unsupported_file_type": "Type de fichier non pris en charge"
  }
}
EOF
        ;;
        "sw")
          cat > "$file" << 'EOF'
{
  "errors": {
    "generic_error": "Kuna kosa",
    "network_error": "Kosa la mtandao",
    "not_found": "Haipatikani",
    "unauthorized": "Hajaruhusiwa",
    "forbidden": "Karimu",
    "server_error": "Kosa la seva",
    "validation_error": "Kosa la uthibitisho",
    "invalid_input": "Ingizo si sahihi",
    "required_field": "Sehemu inayohitajika",
    "invalid_email": "Barua pepe si sahihi",
    "invalid_phone": "Nambari ya simu si sahihi",
    "something_went_wrong": "Kitu kimekosa",
    "please_try_again": "Tafadhali jaribu tena",
    "file_too_large": "Faili ni kubwa sana",
    "unsupported_file_type": "Aina ya faili haisupportiwi"
  }
}
EOF
        ;;
        "ar")
          cat > "$file" << 'EOF'
{
  "errors": {
    "generic_error": "حدث خطأ",
    "network_error": "خطأ في الشبكة",
    "not_found": "غير موجود",
    "unauthorized": "غير مصرح",
    "forbidden": "ممنوع",
    "server_error": "خطأ في الخادم",
    "validation_error": "خطأ في التحقق",
    "invalid_input": "إدخال غير صحيح",
    "required_field": "حقل مطلوب",
    "invalid_email": "عنوان بريد إلكتروني غير صحيح",
    "invalid_phone": "رقم هاتف غير صحيح",
    "something_went_wrong": "حدث خطأ ما",
    "please_try_again": "يرجى المحاولة مرة أخرى",
    "file_too_large": "الملف كبير جدا",
    "unsupported_file_type": "نوع الملف غير مدعوم"
  }
}
EOF
        ;;
        "pt")
          cat > "$file" << 'EOF'
{
  "errors": {
    "generic_error": "Ocorreu um erro",
    "network_error": "Erro de rede",
    "not_found": "Não encontrado",
    "unauthorized": "Não autorizado",
    "forbidden": "Proibido",
    "server_error": "Erro do servidor",
    "validation_error": "Erro de validação",
    "invalid_input": "Entrada inválida",
    "required_field": "Campo obrigatório",
    "invalid_email": "Email inválido",
    "invalid_phone": "Número de telefone inválido",
    "something_went_wrong": "Algo deu errado",
    "please_try_again": "Por favor, tente novamente",
    "file_too_large": "Arquivo muito grande",
    "unsupported_file_type": "Tipo de arquivo não suportado"
  }
}
EOF
        ;;
        "zh")
          cat > "$file" << 'EOF'
{
  "errors": {
    "generic_error": "发生错误",
    "network_error": "网络错误",
    "not_found": "未找到",
    "unauthorized": "未授权",
    "forbidden": "禁止",
    "server_error": "服务器错误",
    "validation_error": "验证错误",
    "invalid_input": "无效的输入",
    "required_field": "必填字段",
    "invalid_email": "无效的电子邮件",
    "invalid_phone": "无效的电话号码",
    "something_went_wrong": "出错了",
    "please_try_again": "请重试",
    "file_too_large": "文件过大",
    "unsupported_file_type": "不支持的文件类型"
  }
}
EOF
        ;;
      esac
      ;;
  esac
}

# Populate all files for all languages
echo "Populating translation files..."
for lang in "${LANGUAGES[@]}"; do
  echo "Populating $lang translations..."
  populate_file "$lang" "auth"
  populate_file "$lang" "errors"
done

echo "Translation files populated successfully!"
