#include<iostream>
using namespace std;
int main(){
  cout<<"Enter number: ";
  int n;
  cin>>n;
  bool istrue = true;
  for (int i = 2; i<=n-1; i++){
    if (n%i==0){
      istrue = false;
      break;
    }
  }
  if (istrue == true){
    cout<<n<<" is prime.";
  }else {
    cout<<n<<" is not prime.";
  }
  cout<<endl;
  return 0;
}