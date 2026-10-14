# Shuvi Windows trusted installation

Windows 11 Smart App Control blocked unsigned Shuvi 0.1.1 both directly and inside a ZIP. This is a publisher trust issue. Do NOT disable Smart App Control, Defender, or security policy.

## Free Microsoft Store MSIX signing

Microsoft Store has free individual developer registration, with government ID and selfie verification, at https://storedeveloper.microsoft.com/.

1. The owner registers as an individual and reserves Shuvi if available.
2. Read the EXACT Package Identity Name, Publisher (CN=...) and Publisher Display Name in Partner Center.
3. In GitHub Actions, run "Shuvi Microsoft Store MSIX (Submission Only)" on the development branch with those exact values.
4. Upload the unsigned result for Microsoft certification. Microsoft Store signs MSIX after approval; this is NOT a direct downloadable trusted package.
5. Test Shuvi Windows native controls, Adobe, Blender and approval gates on the actual signed Store package. MSIX may affect paths and permissions. No end-to-end confirmation yet.

Sources:
https://learn.microsoft.com/windows/apps/publish/whats-new-individual-developer
https://learn.microsoft.com/windows/apps/package-and-deploy/code-signing-options
https://learn.microsoft.com/windows/msix/desktop/desktop-to-uwp-manual-conversion

## Direct standalone EXE

Requires a valid CA-trusted Authenticode code signing certificate, signed executable AND installer and independent signature verification. Do not commit signing credentials to GitHub. No certificate exists in Shuvi's current setup. Simply placing the same unsigned EXE into a ZIP does not bypass Smart App Control.

https://v2.tauri.app/distribute/sign/windows/
https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions

The Store process requires user identity verification and Microsoft review. Neither can be bypassed by our GitHub build. The generated unsigned MSIX is for submission ONLY, not personal sideloading.
