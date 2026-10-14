using System;
using System.IO;
using System.Net.Http;
using System.Drawing;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Program {
    [STAThread] static int Main(string[] args) {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        string root=AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        string data=Path.GetFullPath(Option(args,"--data-dir",Environment.GetEnvironmentVariable("WRITER_DATA")??Path.Combine(root,"data")));
        string profile=Path.GetFullPath(Option(args,"--profile-dir",Path.Combine(data,"desktop-browser")));
        int port; if(!Int32.TryParse(Option(args,"--port",Environment.GetEnvironmentVariable("PORT")??"4317"),out port)||port<1024||port>65535) return 2;
        string key; using(var sha=SHA256.Create())key=BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(data.ToUpperInvariant()))).Replace("-","").Substring(0,24);
        bool first; using(var mutex=new Mutex(true,"Local\\WriterHelper-"+key,out first)) {
            if(!first) {
                for(int i=0;i<50;i++){try{using(var signal=EventWaitHandle.OpenExisting("Local\\WriterHelper-Show-"+key))signal.Set();return 0;}catch(WaitHandleCannotBeOpenedException){Thread.Sleep(100);}}
                return 3;
            }
            using(var signal=new EventWaitHandle(false,EventResetMode.AutoReset,"Local\\WriterHelper-Show-"+key)) {
                var form=new StudioWindow(root,data,profile,port,Array.IndexOf(args,"--self-test")>=0,Option(args,"--report",Path.Combine(root,"reports","desktop-self-test.json")),args);
                form.CreateControl(); var wait=ThreadPool.RegisterWaitForSingleObject(signal,delegate{try{form.BeginInvoke(new Action(form.RestoreWindow));}catch(InvalidOperationException){}},null,Timeout.Infinite,false);
                try{Application.Run(form);return form.Result;}finally{wait.Unregister(null);mutex.ReleaseMutex();}
            }
        }
    }
    internal static string Option(string[] args,string name,string fallback){int i=Array.IndexOf(args,name);return i>=0&&i+1<args.Length?args[i+1]:fallback;}
}

internal sealed class StudioWindow:Form {
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window,int command);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    readonly string root,data,profile,url,report; readonly bool selfTest,taskbarEnabled; readonly string[] arguments;
    readonly WebView2 browser=new WebView2(); readonly NotifyIcon tray=new NotifyIcon();
    readonly Label loading=new Label(); readonly HttpClient http=new HttpClient(new HttpClientHandler{UseProxy=false});
    Process server; bool exiting,exitRequested,ready; int activations; bool started;
    readonly TaskCompletionSource<bool> downloadTest=new TaskCompletionSource<bool>();
    internal int Result=0;
    public StudioWindow(string root,string data,string profile,int port,bool selfTest,string report,string[] arguments){
        this.root=root;this.data=data;this.profile=profile;this.selfTest=selfTest;taskbarEnabled=!selfTest||Array.IndexOf(arguments,"--taskbar-self-test")>=0;this.report=report;this.arguments=arguments;url="http://localhost:"+port;
        Text="WriterHelper — рабочее место автора";Width=1440;Height=960;MinimumSize=new Size(800,600);StartPosition=FormStartPosition.CenterScreen;
        Icon=new Icon(Path.Combine(root,"desktop","WriterHelper.ico"));
        browser.Dock=DockStyle.Fill;Controls.Add(browser);loading.Dock=DockStyle.Fill;loading.Text="WriterHelper запускается…";loading.TextAlign=ContentAlignment.MiddleCenter;loading.BackColor=Color.FromArgb(23,30,26);loading.ForeColor=Color.FromArgb(236,237,231);Controls.Add(loading);
        tray.Icon=Icon;tray.Text="WriterHelper";tray.Visible=true;
        var menu=new ContextMenuStrip();menu.Items.Add("Открыть WriterHelper",null,delegate{RestoreWindow();});menu.Items.Add("Свернуть в трей",null,delegate{HideToTray();});menu.Items.Add(new ToolStripSeparator());menu.Items.Add("Выход",null,async delegate{await ExitAsync();});tray.ContextMenuStrip=menu;tray.DoubleClick+=delegate{RestoreWindow();};
        Resize+=delegate{if(WindowState==FormWindowState.Minimized)HideToTray();};
        FormClosing+=delegate(object sender,FormClosingEventArgs e){if(!exiting){if(e.CloseReason==CloseReason.UserClosing){e.Cancel=true;HideToTray();}else{e.Cancel=true;BeginInvoke(new Action(async delegate{await ExitAsync();}));}}};
        Shown+=async delegate{if(started)return;started=true;await StartAsync(port);};
        ShowInTaskbar=taskbarEnabled;if(selfTest){Opacity=0;}
        http.Timeout=TimeSpan.FromSeconds(2);
    }
    internal void RestoreWindow(){activations++;Show();WindowState=FormWindowState.Normal;ShowWindow(Handle,9);SetForegroundWindow(Handle);Activate();browser.Focus();}
    // Hide removes the taskbar button without recreating the native window that hosts WebView2.
    void HideToTray(){Hide();}
    async Task StartAsync(int port){
        try{
            Directory.CreateDirectory(data);Directory.CreateDirectory(profile);
            var info=await ServerInfo();
            if(info==null){
                string node=Path.Combine(root,".desktop","node.exe");if(!File.Exists(node))throw new Exception("Не найден встроенный Node.js. Выполните npm run build:desktop.");
                var start=new ProcessStartInfo(node,"\""+Path.Combine(root,"server","index.js")+"\""){WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};
                start.EnvironmentVariables["WRITER_DATA"]=data;start.EnvironmentVariables["PORT"]=port.ToString();
                server=new Process{StartInfo=start};server.OutputDataReceived+=delegate(object s,DataReceivedEventArgs e){if(e.Data!=null)Log(e.Data);};server.ErrorDataReceived+=delegate(object s,DataReceivedEventArgs e){if(e.Data!=null)Log(e.Data);};
                server.Start();server.BeginOutputReadLine();server.BeginErrorReadLine();
                for(int i=0;i<80;i++){if(server.HasExited)throw new Exception("Локальный сервер не запустился. Проверьте data\\desktop.log.");info=await ServerInfo();if(info!=null)break;await Task.Delay(150);}
            }
            if(info==null||!info.ContainsKey("product")||(string)info["product"]!="WriterHelper"||!SamePath((string)info["data"],data)||!SamePath((string)info["root"],root))throw new Exception("Порт занят другим приложением или другой папкой данных. Закройте прежний сервер либо задайте другой --port.");
            Log("Server ready; creating browser environment");
            var environment=await CoreWebView2Environment.CreateAsync(null,profile);
            Log("Browser environment ready");
            var browserHandle=browser.Handle;
            await browser.EnsureCoreWebView2Async(environment);
            Log("Browser control ready");
            browser.CoreWebView2.Settings.AreDevToolsEnabled=selfTest;browser.CoreWebView2.Settings.IsStatusBarEnabled=false;
            browser.CoreWebView2.DownloadStarting+=delegate(object sender,CoreWebView2DownloadStartingEventArgs e){
                if(selfTest&&Array.IndexOf(arguments,"--download-self-test")>=0){
                    e.ResultFilePath=Path.Combine(data,"export-self-test.txt");e.Handled=true;
                    var operation=e.DownloadOperation;
                    operation.StateChanged+=delegate{if(operation.State==CoreWebView2DownloadState.Completed)downloadTest.TrySetResult(true);else if(operation.State==CoreWebView2DownloadState.Interrupted)downloadTest.TrySetResult(false);};
                    return;
                }
                using(var save=new SaveFileDialog()){
                    save.Title="Выгрузить книгу";save.FileName=Path.GetFileName(e.ResultFilePath);save.OverwritePrompt=true;
                    string extension=Path.GetExtension(save.FileName).TrimStart('.');save.DefaultExt=extension;save.AddExtension=true;
                    save.Filter="Файл книги (*."+extension+")|*."+extension+"|Все файлы (*.*)|*.*";
                    if(save.ShowDialog(this)==DialogResult.OK){e.ResultFilePath=save.FileName;e.Handled=true;}else e.Cancel=true;
                }
            };
            browser.CoreWebView2.NavigationStarting+=delegate(object s,CoreWebView2NavigationStartingEventArgs e){Uri target;if(Uri.TryCreate(e.Uri,UriKind.Absolute,out target)&&target.GetLeftPart(UriPartial.Authority)!=url){e.Cancel=true;OpenLink(e.Uri);}};
            browser.CoreWebView2.NewWindowRequested+=delegate(object s,CoreWebView2NewWindowRequestedEventArgs e){e.Handled=true;OpenLink(e.Uri);};
            var loaded=new TaskCompletionSource<bool>();browser.CoreWebView2.NavigationCompleted+=delegate(object s,CoreWebView2NavigationCompletedEventArgs e){if(e.IsSuccess)loaded.TrySetResult(true);else loaded.TrySetException(new Exception("Не удалось открыть интерфейс: "+e.WebErrorStatus));};
            browser.Source=new Uri(url);await loaded.Task;ready=true;loading.Hide();Log("Interface loaded");
            if(selfTest)await SmokeTest();else RestoreWindow();
        }catch(Exception ex){Log(ex.ToString());Result=1;if(selfTest){WriteReport(new Dictionary<string,object>{{"status","FAIL"},{"error",ex.Message}});}else MessageBox.Show(this,ex.Message,"WriterHelper",MessageBoxButtons.OK,MessageBoxIcon.Error);exiting=true;Close();}
    }
    async Task<Dictionary<string,object>> ServerInfo(){try{Log("Probing server");string value=await http.GetStringAsync(url.Replace("localhost","127.0.0.1")+"/api/desktop/info").ConfigureAwait(false);Log("Probe received "+value.Length);return new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(value);}catch(HttpRequestException ex){Log("Probe HTTP: "+ex.Message);return null;}catch(TaskCanceledException){Log("Probe timeout");return null;}catch(ArgumentException ex){Log("Probe JSON: "+ex.Message);return null;}}
    static bool SamePath(string a,string b){return String.Equals(Path.GetFullPath(a).TrimEnd('\\','/'),Path.GetFullPath(b).TrimEnd('\\','/'),StringComparison.OrdinalIgnoreCase);}
    void OpenLink(string uri){Uri target;if(Uri.TryCreate(uri,UriKind.Absolute,out target)&&(target.Scheme=="https"||target.Scheme=="http"))Process.Start(new ProcessStartInfo(uri){UseShellExecute=true});}
    async Task<bool> FlushDrafts(){
        if(!ready)return true;
        string token=Guid.NewGuid().ToString("N");var done=new TaskCompletionSource<bool>();
        EventHandler<CoreWebView2WebMessageReceivedEventArgs> handler=delegate(object sender,CoreWebView2WebMessageReceivedEventArgs e){try{if(new Uri(e.Source).GetLeftPart(UriPartial.Authority)!=url)return;var message=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(e.WebMessageAsJson);if(message.ContainsKey("token")&&(string)message["token"]==token)done.TrySetResult(message.ContainsKey("ok")&&(bool)message["ok"]);}catch(Exception){}};
        browser.CoreWebView2.WebMessageReceived+=handler;
        try{await browser.CoreWebView2.ExecuteScriptAsync("(async()=>{const detail={promises:[]};try{window.dispatchEvent(new CustomEvent('writerhelper-desktop-flush',{detail}));await Promise.all(detail.promises);chrome.webview.postMessage({token:'"+token+"',ok:true});}catch(e){chrome.webview.postMessage({token:'"+token+"',ok:false});}})()");return await Task.WhenAny(done.Task,Task.Delay(10000))==done.Task&&await done.Task;}finally{browser.CoreWebView2.WebMessageReceived-=handler;}
    }
    async Task ExitAsync(){
        if(exitRequested)return;exitRequested=true;
        try{
            if(!await FlushDrafts())throw new Exception("Не удалось сохранить локальный черновик. Вернитесь в редактор и сохраните материал перед выходом.");
            if(server!=null&&!server.HasExited){
                string state=await http.GetStringAsync(url.Replace("localhost","127.0.0.1")+"/api/state");var value=new JavaScriptSerializer{MaxJsonLength=Int32.MaxValue}.Deserialize<Dictionary<string,object>>(state);bool running=false;foreach(var entry in (System.Collections.ArrayList)value["entities"]){var row=(Dictionary<string,object>)entry;if((string)row["type"]=="candidate"&&row.ContainsKey("status")&&(string)row["status"]=="running")running=true;}
                if(running&&!selfTest&&MessageBox.Show(this,"Сейчас выполняется генерация. Выход остановит её. Выйти?","WriterHelper",MessageBoxButtons.YesNo,MessageBoxIcon.Question)!=DialogResult.Yes){exitRequested=false;return;}
            }
            exiting=true;Close();
        }catch(Exception ex){exitRequested=false;RestoreWindow();MessageBox.Show(this,ex.Message,"WriterHelper",MessageBoxButtons.OK,MessageBoxIcon.Warning);}
    }
    async Task SmokeTest(){
        for(int i=0;i<60;i++){string loaded=await browser.CoreWebView2.ExecuteScriptAsync("!!document.querySelector('.studio')");if(loaded=="true")break;await Task.Delay(100);}
        string title=await browser.CoreWebView2.ExecuteScriptAsync("document.title");
        string populated=await browser.CoreWebView2.ExecuteScriptAsync("!!document.querySelector('.studio')");if(populated!="true")throw new Exception("Интерфейс не отрисован");
        string persisted=await browser.CoreWebView2.ExecuteScriptAsync("localStorage.getItem('writerhelper-desktop-smoke')==='saved'");await browser.CoreWebView2.ExecuteScriptAsync("localStorage.setItem('writerhelper-desktop-smoke','saved')");
        bool downloadChecked=false;
        if(Array.IndexOf(arguments,"--download-self-test")>=0){
            await browser.CoreWebView2.ExecuteScriptAsync("(async()=>{const state=await(await fetch('/api/state')).json();const book=state.entities.find(e=>e.type==='book');const response=await fetch('/api/book/export',{method:'POST',headers:{'Content-Type':'application/json','X-Writer-Client':'1'},body:JSON.stringify({book:book.id,format:'txt'})});if(!response.ok)throw new Error('Export failed');const link=document.createElement('a');link.href=URL.createObjectURL(await response.blob());link.download='export-self-test.txt';document.body.append(link);link.click();link.remove();})()");
            if(await Task.WhenAny(downloadTest.Task,Task.Delay(10000))!=downloadTest.Task||!await downloadTest.Task||!File.Exists(Path.Combine(data,"export-self-test.txt")))throw new Exception("Не пройдена проверка скачивания книги");
            downloadChecked=true;
        }
        IntPtr originalHandle=Handle,originalBrowserHandle=browser.Handle;
        await browser.CoreWebView2.ExecuteScriptAsync("window.writerTrayDraft={text:'Несохранённая правка 🙂',selection:[2,8]};");
        WindowState=FormWindowState.Minimized;await Task.Delay(50);bool minimized=!Visible&&tray.Visible;
        RestoreWindow();bool restored=Visible&&WindowState==FormWindowState.Normal;Close();bool closedToTray=!Visible&&tray.Visible&&!IsDisposed;
        int count=activations;var second=Process.Start(new ProcessStartInfo(Application.ExecutablePath,"--data-dir \""+data+"\" --profile-dir \""+profile+"\" --port "+new Uri(url).Port){UseShellExecute=false,CreateNoWindow=true});await Task.Run(()=>second.WaitForExit(5000));await Task.Delay(200);bool singleton=second.HasExited&&second.ExitCode==0&&activations>count;
        bool stableHandle=Handle==originalHandle&&browser.Handle==originalBrowserHandle;
        for(int cycle=0;cycle<3;cycle++){Close();await Task.Delay(50);if(Visible)throw new Exception("Окно осталось видно после крестика");RestoreWindow();await Task.Delay(50);if(Handle!=originalHandle||browser.Handle!=originalBrowserHandle)stableHandle=false;}
        bool draftInMemory=await browser.CoreWebView2.ExecuteScriptAsync("window.writerTrayDraft?.text==='Несохранённая правка 🙂'&&window.writerTrayDraft?.selection[1]===8")=="true";
        string stillRendered=await browser.CoreWebView2.ExecuteScriptAsync("!!document.querySelector('.studio')");
        Directory.CreateDirectory(Path.GetDirectoryName(report));using(var output=File.Create(Path.ChangeExtension(report,".png")))await browser.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,output);
        if(!draftInMemory)throw new Exception("Состояние редактора потеряно при закрытии в трей");
        if(!stableHandle)throw new Exception("При сворачивании в трей пересоздано окно WebView2");
        if(stillRendered!="true")throw new Exception("Интерфейс потерян после восстановления из трея");
        if(!minimized||!restored||!closedToTray||!singleton)throw new Exception("Не пройдена проверка трея или повторного запуска");
        bool flushed=await FlushDrafts();if(!flushed)throw new Exception("Не пройдена проверка сохранения черновиков");
        WriteReport(new Dictionary<string,object>{{"status","PASS"},{"title",title},{"url",url},{"data",data},{"serverOwned",server!=null},{"minimizedToTray",minimized},{"closedToTray",closedToTray},{"restored",restored},{"singleInstance",singleton},{"stableWindowHandles",stableHandle},{"inMemoryStatePreserved",draftInMemory},{"interfaceAfterRestore",stillRendered=="true"},{"taskbarEnabled",taskbarEnabled},{"profilePersisted",persisted=="true"},{"draftFlush",flushed},{"bookDownload",downloadChecked}});
        await ExitAsync();
    }
    void WriteReport(Dictionary<string,object> value){Directory.CreateDirectory(Path.GetDirectoryName(report));File.WriteAllText(report,new JavaScriptSerializer().Serialize(value),Encoding.UTF8);}
    void Log(string text){try{Directory.CreateDirectory(data);File.AppendAllText(Path.Combine(data,"desktop.log"),DateTime.Now.ToString("s")+" "+text+Environment.NewLine,Encoding.UTF8);}catch(IOException){}}
    protected override void Dispose(bool disposing){if(disposing){tray.Visible=false;tray.Dispose();browser.Dispose();http.Dispose();if(server!=null){try{if(!server.HasExited){server.Kill();server.WaitForExit(5000);}}catch(InvalidOperationException){}server.Dispose();}}base.Dispose(disposing);}
}
