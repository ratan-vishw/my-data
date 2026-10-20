const myCheckBox = document.getElementById("myCheckBox");
const visabtn = document.getElementById("visabtn");
const masterCardbtn = document.getElementById("masterCardbtn");
const paypalbtn = document.getElementById("paypalbtn");
const mySubmitbtn = document.getElementById("mySubmitbtn");
const subResult = document.getElementById("subResult");
const paymentResult = document.getElementById("paymentResult");

mySubmitbtn.onclick = function(){
  if(myCheckBox.checked){
    subResult.textContent = "You are Subscribe";
  }else {
    subResult.textContent = "You are not Subcribe";
  }

  if (visabtn.checked){
    paymentResult.textContent = "You are paying with Visa."
  }
  else if(masterCardbtn.checked){
    paymentResult.textContent = "You are paying with Master Card."
  }
  else if(paypalbtn.checked){
    paymentResult.textContent = "You are paying with Paypal."
  }
}